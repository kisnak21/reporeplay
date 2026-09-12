'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { CoverageWarning, TimelineItem } from '@/server/contracts/api'
import type { RunStatus } from '@/server/contracts/processing'
import { ApiError, fetchApi } from '@/lib/client-api'
import { createMutationRequest } from '@/lib/idempotent-request'
import {
	EMPTY_TIMELINE_FILTERS,
	readTimelineFilters,
	serializeTimelineFilters,
	type TimelineFilters,
} from '@/lib/timeline-filters'
import { ui } from '@/lib/ui'
import { Timeline } from '@/components/timeline'

interface RepositorySnapshot {
	runId: string
	rootSha: string
	headSha: string
	firstParentCommitCount: number
	firstCommitAt: string
	lastCommitAt: string
	processedAt: string
	routeCount: number
	dependencyCount: number
	versions: {
		schema: string
		classifier: string
		dependencyDetector: string
		routeDetector: string
	}
	coverage: { status: string; warnings: CoverageWarning[] }
}

interface RepositoryResponse {
	id: string
	owner: string
	name: string
	fullName: string
	canonicalUrl: string
	defaultBranch: string
	selectedAppRoot: string | null
	availability: string
	activeSnapshot: RepositorySnapshot | null
	latestRun: {
		id: string
		status: RunStatus
		kind: 'IMPORT' | 'REFRESH' | 'REPROCESS'
		error: { code: string; message: string | null } | null
	} | null
}

interface TimelineResponse {
	snapshot: { runId: string; headSha: string } | null
	items: TimelineItem[]
	pageInfo: { nextCursor: string | null; hasNextPage: boolean }
}

const ACTIVE_REFRESH_STATUSES = new Set<RunStatus>([
	'NEEDS_CONFIGURATION',
	'QUEUED',
	'RUNNING',
	'WAITING_RATE_LIMIT',
	'RETRYABLE',
])
const EMPTY_PAGE = { nextCursor: null, hasNextPage: false }

function timelineScrollKey(repositoryId: string, filterSearch: string): string {
	return `reporeplay:timeline-scroll:${repositoryId}:${filterSearch}`
}

export function LiveRepositoryView({ repositoryId }: { repositoryId: string }) {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const filters = readTimelineFilters(searchParams)
	const filterSearch = serializeTimelineFilters(filters)
	const [repository, setRepository] = useState<RepositoryResponse | null>(null)
	const [repositoryError, setRepositoryError] = useState('')
	const [timeline, setTimeline] = useState<{
		key: string
		data: TimelineResponse
	} | null>(null)
	const [timelineError, setTimelineError] = useState('')
	const [mismatch, setMismatch] = useState<string | null>(null)
	const [loadingOlder, setLoadingOlder] = useState(false)
	const [refreshError, setRefreshError] = useState('')
	const [refreshing, setRefreshing] = useState(false)
	const [reloadKey, setReloadKey] = useState(0)
	const [mutate] = useState(createMutationRequest)
	const olderRequest = useRef<AbortController | null>(null)
	const timelineKey = `${repositoryId}:${filterSearch}:${reloadKey}`
	const currentTimeline = timeline?.key === timelineKey ? timeline.data : null

	useEffect(() => {
		const controller = new AbortController()
		async function loadRepository() {
			try {
				const data = await fetchApi<RepositoryResponse>(
					`/api/repositories/${repositoryId}`,
					{ signal: controller.signal },
				)
				if (controller.signal.aborted) return
				setRepository(data)
				setRepositoryError('')
			} catch (error) {
				if (!controller.signal.aborted)
					setRepositoryError(
						error instanceof Error
							? error.message
							: 'The repository could not be loaded.',
					)
			}
		}
		void loadRepository()
		return () => controller.abort()
	}, [repositoryId, reloadKey])

	useEffect(() => {
		const controller = new AbortController()
		olderRequest.current?.abort()
		async function loadTimeline() {
			try {
				const data = await fetchApi<TimelineResponse>(
					`/api/repositories/${repositoryId}/commits?limit=30&${filterSearch}`,
					{ signal: controller.signal },
				)
				if (controller.signal.aborted) return
				setTimeline({ key: timelineKey, data })
				setTimelineError('')
				setMismatch(null)
			} catch (error) {
				if (controller.signal.aborted) return
				setTimelineError(
					error instanceof Error
						? error.message
						: 'The timeline could not be loaded.',
				)
			} finally {
				if (!controller.signal.aborted) setLoadingOlder(false)
			}
		}
		void loadTimeline()
		return () => {
			controller.abort()
			olderRequest.current?.abort()
		}
	}, [repositoryId, filterSearch, timelineKey])

	useEffect(() => {
		if (!repository || !currentTimeline) return
		const key = timelineScrollKey(repositoryId, filterSearch)
		let savedPosition: string | null = null
		try {
			savedPosition = window.sessionStorage.getItem(key)
			if (savedPosition !== null) window.sessionStorage.removeItem(key)
		} catch {
			return
		}
		if (savedPosition === null) return
		const position = Number(savedPosition)
		if (!Number.isFinite(position) || position < 0) return
		const frame = window.requestAnimationFrame(() => window.scrollTo(0, position))
		return () => window.cancelAnimationFrame(frame)
	}, [currentTimeline, filterSearch, repository, repositoryId])

	function updateFilters(changes: Partial<TimelineFilters>) {
		olderRequest.current?.abort()
		setTimelineError('')
		setMismatch(null)
		const nextFilters = {
			...readTimelineFilters(new URLSearchParams(window.location.search)),
			...changes,
		}
		const search = serializeTimelineFilters(nextFilters)
		window.history.replaceState(
			null,
			'',
			search ? `${pathname}?${search}` : pathname,
		)
	}

	async function loadOlder() {
		const cursor = currentTimeline?.pageInfo.nextCursor
		if (!cursor || loadingOlder) return
		const controller = new AbortController()
		olderRequest.current = controller
		setLoadingOlder(true)
		setTimelineError('')
		try {
			const params = new URLSearchParams(filterSearch)
			params.set('limit', '30')
			params.set('cursor', cursor)
			const data = await fetchApi<TimelineResponse>(
				`/api/repositories/${repositoryId}/commits?${params}`,
				{ signal: controller.signal },
			)
			if (controller.signal.aborted) return
			setTimeline((previous) =>
				previous?.key === timelineKey
					? {
							key: timelineKey,
							data: { ...data, items: [...previous.data.items, ...data.items] },
						}
					: previous,
			)
		} catch (error) {
			if (controller.signal.aborted) return
			if (
				error instanceof ApiError &&
				error.code === 'CURSOR_SNAPSHOT_MISMATCH'
			)
				setMismatch(error.message)
			else
				setTimelineError(
					error instanceof Error
						? error.message
						: 'Older commits could not be loaded.',
				)
		} finally {
			if (olderRequest.current === controller) {
				olderRequest.current = null
				setLoadingOlder(false)
			}
		}
	}

	function reloadFromTop() {
		setMismatch(null)
		setTimelineError('')
		setReloadKey((value) => value + 1)
	}

	async function startRefresh() {
		if (refreshing) return
		setRefreshing(true)
		setRefreshError('')
		try {
			const result = await mutate<{
				repositoryId: string
				run: { id: string }
			}>(`/api/repositories/${repositoryId}/refresh`)
			router.push(
				`/repositories/${result.repositoryId}/processing/${result.run.id}`,
			)
		} catch (error) {
			setRefreshError(
				error instanceof Error
					? error.message
					: 'The repository could not be queued for refresh.',
			)
		} finally {
			setRefreshing(false)
		}
	}

	if (!repository && repositoryError)
		return (
			<div
				className={ui.alert}
				role='alert'
			>
				<strong>Repository unavailable.</strong>
				<p>{repositoryError}</p>
				<button
					className={ui.button}
					onClick={reloadFromTop}
					type='button'
				>
					Retry repository request
				</button>
			</div>
		)
	if (!repository)
		return (
			<p
				className='font-mono text-sm text-muted'
				role='status'
			>
				Loading repository evidence...
			</p>
		)

	const snapshot = repository.activeSnapshot
	const latestRefresh =
		repository.latestRun?.kind === 'REFRESH' ? repository.latestRun : null
	const refreshInProgress = latestRefresh
		? ACTIVE_REFRESH_STATUSES.has(latestRefresh.status)
		: false
	const visibleRefresh =
		latestRefresh?.status === 'SUCCEEDED' ? null : latestRefresh
	const pageInfo = currentTimeline?.pageInfo ?? EMPTY_PAGE

	return (
		<>
			<header className='flex items-end justify-between gap-8 border-b border-line pb-5 max-[800px]:flex-col max-[800px]:items-start'>
				<div className='min-w-0'>
					<h1 className='m-0 break-all text-[clamp(2.2rem,5vw,4.5rem)] leading-tight'>
						{repository.owner}/{repository.name}
					</h1>
					<div className='mt-3 flex flex-wrap gap-4 break-all font-mono text-xs text-muted'>
						<span>branch {repository.defaultBranch}</span>
						<span>app root {repository.selectedAppRoot ?? '.'}</span>
						<span>{repository.availability}</span>
					</div>
				</div>
				<div className='flex shrink-0 flex-wrap items-center gap-3'>
					<button
						aria-describedby={refreshInProgress ? 'refresh-state' : undefined}
						className={`${ui.primaryButton} disabled:cursor-wait disabled:opacity-60`}
						disabled={!snapshot || refreshing || refreshInProgress}
						onClick={() => void startRefresh()}
						type='button'
					>
						{refreshing
							? 'Checking GitHub...'
							: refreshInProgress
								? 'Refresh in progress'
								: 'Refresh from GitHub'}
					</button>
					<a
						className='inline-flex min-h-11 items-center font-mono text-xs text-cyan'
						href={repository.canonicalUrl}
					>
						Open source
					</a>
				</div>
			</header>
			{repositoryError ? (
				<p
					className='mt-4 text-sm text-negative'
					role='alert'
				>
					{repositoryError}
				</p>
			) : null}
			{refreshError ? (
				<div
					className={ui.alert}
					role='alert'
				>
					<strong>Refresh could not start.</strong>
					<p>{refreshError}</p>
					<p>The current snapshot remains available.</p>
				</div>
			) : null}
			{snapshot ? (
				<>
					{visibleRefresh ? (
						<RefreshNotice
							repositoryId={repositoryId}
							run={visibleRefresh}
							snapshot={snapshot}
						/>
					) : null}
					<div
						className={ui.dataGrid}
						aria-label='Repository summary'
					>
						<Fact
							label='history'
							value={`${snapshot.firstParentCommitCount} complete`}
						/>
						<Fact
							label='routes at head'
							value={String(snapshot.routeCount)}
						/>
						<Fact
							label='declared dependencies'
							value={String(snapshot.dependencyCount)}
						/>
						<Fact
							label='coverage warnings'
							value={String(snapshot.coverage.warnings.length)}
						/>
					</div>
					<SnapshotDetails snapshot={snapshot} />
					{snapshot.coverage.warnings.length ? (
						snapshot.coverage.warnings.map((warning, index) => (
							<div
								className={ui.alert}
								key={`${warning.code}-${warning.path ?? 'run'}-${index}`}
							>
								<strong>Coverage warning.</strong>
								<p>
									{warning.message}{' '}
									<code className='break-all'>
										{warning.path ?? 'detector-wide'}
									</code>
								</p>
								<p className='break-all font-mono text-xs'>
									{warning.code} · detector{' '}
									{warning.detectorVersion ?? 'unrecorded'}
								</p>
							</div>
						))
					) : (
						<p className='mt-4 text-sm text-muted'>
							Full supported coverage. No detector limitations were recorded.
						</p>
					)}
					{timelineError ? (
						<div
							className={ui.alert}
							role='alert'
						>
							<strong>Timeline request failed.</strong>
							<p>{timelineError}</p>
							<button
								className={ui.button}
								onClick={() =>
									currentTimeline ? void loadOlder() : reloadFromTop()
								}
								type='button'
							>
								Retry timeline request
							</button>
						</div>
					) : null}
					<Timeline
						commits={currentTimeline?.items ?? []}
						repositoryId={repositoryId}
						query={filters.query}
						event={filters.event}
						filters={filters}
						onFiltersChange={updateFilters}
						filterSearch={filterSearch}
						onQueryChange={(query) => updateFilters({ query })}
						onEventChange={(event) => updateFilters({ event })}
						onClearFilters={() => updateFilters(EMPTY_TIMELINE_FILTERS)}
						loading={!currentTimeline && !timelineError}
						onLoadOlder={() => void loadOlder()}
						hasNextPage={pageInfo.hasNextPage}
						loadingOlder={loadingOlder}
						mismatch={mismatch}
						onReloadFromTop={reloadFromTop}
					/>
				</>
			) : (
				<div className={`${ui.alert} mt-6`}>
					<strong>No active snapshot yet.</strong>
					<p>
						{repository.latestRun
							? 'Open the current run to follow progress or review its result.'
							: 'Start an import to create the first snapshot.'}
					</p>
					{repository.latestRun ? (
						<Link
							className={`${ui.button} mt-3`}
							href={`/repositories/${repositoryId}/processing/${repository.latestRun.id}`}
						>
							Open {repository.latestRun.kind.toLowerCase()} status
						</Link>
					) : (
						<Link
							className={`${ui.button} mt-3`}
							href='/'
						>
							Start import
						</Link>
					)}
				</div>
			)}
		</>
	)
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className={ui.datum}>
			<span className='block text-xs uppercase text-muted'>{label}</span>
			<strong className='mt-1 block break-words text-lg'>{value}</strong>
		</div>
	)
}

function SnapshotDetails({ snapshot }: { snapshot: RepositorySnapshot }) {
	const formatTime = (value: string) =>
		new Date(value).toLocaleString('en-GB', {
			timeZone: 'UTC',
			dateStyle: 'medium',
			timeStyle: 'short',
		})
	return (
		<section
			className='mt-6 border-y border-line py-5'
			aria-labelledby='snapshot-title'
		>
			<h2
				className='m-0 text-lg font-semibold'
				id='snapshot-title'
			>
				Analyzed snapshot
			</h2>
			<dl className='mb-0 mt-4 grid grid-cols-2 gap-x-8 gap-y-4 text-sm max-[800px]:grid-cols-1'>
				<div className='min-w-0'>
					<dt className='text-muted'>Root commit</dt>
					<dd className='m-0 mt-1 break-all font-mono'>{snapshot.rootSha}</dd>
				</div>
				<div className='min-w-0'>
					<dt className='text-muted'>Head commit</dt>
					<dd className='m-0 mt-1 break-all font-mono'>{snapshot.headSha}</dd>
				</div>
				<div>
					<dt className='text-muted'>History dates (UTC)</dt>
					<dd className='m-0 mt-1'>
						<time dateTime={snapshot.firstCommitAt}>
							{formatTime(snapshot.firstCommitAt)}
						</time>{' '}
						to{' '}
						<time dateTime={snapshot.lastCommitAt}>
							{formatTime(snapshot.lastCommitAt)}
						</time>
					</dd>
				</div>
				<div>
					<dt className='text-muted'>Processed (UTC)</dt>
					<dd className='m-0 mt-1'>
						<time dateTime={snapshot.processedAt}>
							{formatTime(snapshot.processedAt)}
						</time>
					</dd>
				</div>
				<div className='col-span-full min-w-0'>
					<dt className='text-muted'>Analysis versions</dt>
					<dd className='m-0 mt-1 flex flex-wrap gap-x-5 gap-y-1 break-all font-mono text-xs'>
						<span>schema {snapshot.versions.schema}</span>
						<span>classifier {snapshot.versions.classifier}</span>
						<span>route detector {snapshot.versions.routeDetector}</span>
						<span>
							dependency detector {snapshot.versions.dependencyDetector}
						</span>
					</dd>
				</div>
			</dl>
		</section>
	)
}

function RefreshNotice({
	repositoryId,
	run,
	snapshot,
}: {
	repositoryId: string
	run: NonNullable<RepositoryResponse['latestRun']>
	snapshot: RepositorySnapshot
}) {
	const statusUrl = `/repositories/${repositoryId}/processing/${run.id}`
	const shortHead = snapshot.headSha.slice(0, 7)

	if (run.status === 'FAILED') {
		return (
			<div
				className={ui.alert}
				id='refresh-state'
				role='alert'
			>
				<strong>Refresh failed.</strong>
				<p>
					{run.error?.message ??
						'The latest GitHub data could not be processed.'}
				</p>
				<p>
					Snapshot <code>{shortHead}</code> remains active and its timeline is
					still available.
				</p>
				<p className='font-mono text-xs'>
					Error code:{' '}
					<code className='break-all'>
						{run.error?.code ?? 'PROCESSING_FAILED'}
					</code>
				</p>
				<Link
					className={`${ui.button} mt-3`}
					href={statusUrl}
				>
					Review refresh error
				</Link>
			</div>
		)
	}

	if (run.status === 'CANCELLED') {
		return (
			<div
				className={ui.alert}
				id='refresh-state'
				role='status'
			>
				<strong>Refresh cancelled.</strong>
				<p>
					No snapshot was changed. You are still viewing{' '}
					<code>{shortHead}</code>.
				</p>
				<Link
					className={`${ui.button} mt-3`}
					href={statusUrl}
				>
					Open refresh status
				</Link>
			</div>
		)
	}

	if (run.status === 'NEEDS_CONFIGURATION') {
		return (
			<div
				className={ui.alert}
				id='refresh-state'
				role='status'
			>
				<strong>Refresh needs an application root.</strong>
				<p>
					Snapshot <code>{shortHead}</code> remains active while the new root is
					selected.
				</p>
				<Link
					className={`${ui.button} mt-3`}
					href={statusUrl}
				>
					Open refresh status
				</Link>
			</div>
		)
	}

	return (
		<div
			className={ui.alert}
			id='refresh-state'
			role='status'
		>
			<strong>Refresh in progress.</strong>
			<p>
				You are viewing active snapshot <code>{shortHead}</code> while new
				GitHub evidence is processed.
			</p>
			<Link
				className={`${ui.button} mt-3`}
				href={statusUrl}
			>
				Open refresh status
			</Link>
		</div>
	)
}
