'use strict'

const DEFAULT_REPOSITORY = 'Otter1102/yahooauction-watch'
const DEFAULT_WORKFLOW_ID = '260488766'
const DEFAULT_REF = 'main'
const DEFAULT_TIME_ZONE = 'Asia/Tokyo'
const DEFAULT_FALLBACK_AFTER_MINUTE = 10

function getJstParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    hourKey: `${map.year}-${map.month}-${map.day}T${map.hour}`,
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10),
  }
}

function isQuietHour(hour) {
  return hour >= 1 && hour <= 6
}

function isSameHour(createdAt, currentHourKey, timeZone = DEFAULT_TIME_ZONE) {
  if (!createdAt) return false
  return getJstParts(new Date(createdAt), timeZone).hourKey === currentHourKey
}

function jsonResponse(res, status, body) {
  res.status(status).set('content-type', 'application/json').send(JSON.stringify(body))
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'yahoo-auction-hourly-fallback',
      ...(options.headers || {}),
    },
  })

  if (response.status === 204) return null
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${data?.message || text || response.statusText}`)
  }
  return data
}

async function hourlyFallback(req, res) {
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' })
  }

  const sharedSecret = process.env.FALLBACK_SHARED_SECRET
  if (sharedSecret && req.get('x-fallback-secret') !== sharedSecret) {
    return jsonResponse(res, 401, { ok: false, error: 'unauthorized' })
  }

  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
  const workflowId = process.env.GITHUB_WORKFLOW_ID || DEFAULT_WORKFLOW_ID
  const ref = process.env.GITHUB_REF || DEFAULT_REF
  const timeZone = process.env.TIME_ZONE || DEFAULT_TIME_ZONE
  const fallbackAfterMinute = Number.parseInt(
    process.env.FALLBACK_AFTER_MINUTE || String(DEFAULT_FALLBACK_AFTER_MINUTE),
    10
  )

  const now = getJstParts(new Date(), timeZone)
  if (isQuietHour(now.hour)) {
    return jsonResponse(res, 200, { ok: true, action: 'skip', reason: 'quiet_hour', now })
  }
  if (now.minute < fallbackAfterMinute) {
    return jsonResponse(res, 200, { ok: true, action: 'skip', reason: 'waiting_for_schedule', now })
  }

  const runs = await githubRequest(
    `/repos/${repository}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(ref)}&per_page=20`
  )
  const workflowRuns = runs?.workflow_runs || []
  const active = workflowRuns.filter(run => run.status === 'queued' || run.status === 'in_progress')
  if (active.length > 0) {
    return jsonResponse(res, 200, {
      ok: true,
      action: 'skip',
      reason: 'workflow_already_active',
      activeRunIds: active.map(run => run.id),
      now,
    })
  }

  const currentHourRun = workflowRuns.find(run => isSameHour(run.created_at, now.hourKey, timeZone))
  if (currentHourRun) {
    return jsonResponse(res, 200, {
      ok: true,
      action: 'skip',
      reason: 'run_exists_for_current_hour',
      runId: currentHourRun.id,
      runCreatedAt: currentHourRun.created_at,
      now,
    })
  }

  await githubRequest(`/repos/${repository}/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ref,
      inputs: {
        force_check_complete: 'false',
        stamp_last_checked_only: 'false',
      },
    }),
  })

  return jsonResponse(res, 200, {
    ok: true,
    action: 'dispatch',
    repository,
    workflowId,
    ref,
    now,
  })
}

module.exports = {
  hourlyFallback,
  getJstParts,
  isQuietHour,
  isSameHour,
}
