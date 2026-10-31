import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { PromptTokens } from '../types'

const PANE = 'token-meter'
const ACTIVE = { plugin: 'token-meter', key: 'active' } as const
const PENDING = { plugin: 'token-meter', key: 'pending' } as const
const LATEST = { plugin: 'token-meter', key: 'latest' } as const
const active = atom(ACTIVE, null)
const pending = atom(PENDING, null)
const latest = atom(LATEST, null)
const links = atom({ plugin: 'token-meter', key: 'links' } as const, null)
const turns = atom({ plugin: 'token-meter', key: 'turns' } as const, null)

// Streamed characters per estimated token, and how often the live estimate
// is written while a response streams.
const CHARS_PER_TOKEN = 4
const WRITE_EVERY_CHARS = 400

const BAR_CELLS = 20
const BAR_PX = 160
const PANE_BAR_PX = 120
// The pinned strip asks for two body rows at most: inline it fits the tree,
// so a line that fits takes one.
const PANE_OPEN = { id: PANE, title: 'Tokens', rows: 2 } as const

function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`

  return `${Math.round(n)}`
}

// The fill the bar draws: the latest response's, else where the prompt began.
function fill(t: PromptTokens): number {
  return t.calls > 0 ? t.context : t.before
}

function percent(t: PromptTokens): number {
  return t.window > 0 ? Math.round((fill(t) / t.window) * 100) : 0
}

function level(t: PromptTokens): 'success' | 'warning' | 'error' {
  const p = percent(t)

  return p >= 90 ? 'error' : p >= 70 ? 'warning' : 'success'
}

const HEX = { success: '#3fb950', warning: '#d29922', error: '#f85149' }

function summary(t: PromptTokens): string {
  const added = Math.max(0, fill(t) - t.before)
  const cached = t.input > 0 ? Math.round((t.cached / t.input) * 100) : 0
  const parts = [
    `${percent(t)}% of ${tokens(t.window)}`,
    `+${tokens(added)} this prompt`,
    `${tokens(t.input)} in (${cached}% cached)`,
    `${tokens(t.output + t.live)} out${t.live > 0 ? '~' : ''}`,
    `${t.calls} ${t.calls === 1 ? 'call' : 'calls'}`,
  ]
  if (t.agents > 0) parts.push(`${tokens(t.agents)} subagents`)

  return parts.join(' · ')
}

// Three spans over the window: what was there before the prompt, what the
// prompt added, and the estimate of the response streaming now.
function spans(t: PromptTokens, size: number): [number, number, number] {
  const at = (n: number) =>
    t.window > 0 ? Math.round(Math.min(1, n / t.window) * size) : 0
  const prior = at(Math.min(t.before, fill(t)))
  const done = at(fill(t))
  const live = at(fill(t) + t.live)

  return [prior, done - prior, live - done]
}

function svg(t: PromptTokens, px: number): string {
  const [prior, added, live] = spans(t, px)
  const color = HEX[level(t)]

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="8" viewBox="0 0 ${px} 8">` +
    `<clipPath id="r"><rect width="${px}" height="8" rx="4"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${px}" height="8" fill="#8b949e" fill-opacity="0.25"/>` +
    `<rect width="${prior}" height="8" fill="#8b949e" fill-opacity="0.75"/>` +
    `<rect x="${prior}" width="${added}" height="8" fill="${color}"/>` +
    `<rect x="${prior + added}" width="${live}" height="8" fill="${color}" fill-opacity="0.45"/>` +
    `</g></svg>`
  )
}

// The bar and its figures, as one row. Pinned, the figures wrap beside the
// bar onto a second line; else the figures drop below the bar when narrow.
function meter(
  els: ElementTable,
  t: PromptTokens,
  px: number,
  isPinned = false,
) {
  const { Box, Text } = els
  let bar
  if ('Svg' in els) {
    const { Svg } = els
    bar = (
      <Svg
        source={svg(t, px)}
        alt={`Context ${percent(t)}% full`}
        width={px}
        height={8}
      />
    )
  } else {
    const [prior, added, live] = spans(t, BAR_CELLS)
    const rest = Math.max(0, BAR_CELLS - prior - added - live)
    bar = (
      <Text>
        <Text dimColor>{'█'.repeat(prior)}</Text>
        <Text color={level(t)}>{'█'.repeat(added)}</Text>
        <Text color={level(t)} dimColor>
          {'▒'.repeat(live)}
        </Text>
        <Text dimColor>{'░'.repeat(rest)}</Text>
      </Text>
    )
  }

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      gap={1}
      flexWrap={isPinned ? 'nowrap' : 'wrap'}
    >
      {bar}
      <Text dimColor size="caption" tabular wrap="wrap">
        {t.isRunning ? '● ' : ''}
        {summary(t)}
      </Text>
    </Box>
  )
}

// Opens the pinned strip; with no surface attached yet the open is refused,
// and the surface's attach opens it again.
function pin($: EngineInterface) {
  return $.ui.open(PANE_OPEN).catch(() => undefined)
}

async function link($: EngineInterface, uuid: string, turnId: string) {
  await $.state.set({ plugin: 'token-meter', key: 'links', id: uuid }, turnId)
  await update($, active, a =>
    a && a.turnId === turnId ? { ...a, isLinked: true } : a,
  )
  await update($, pending, p => (p === uuid ? null : p))
}

export const register: Register = on => {
  // The pinned meter: a pane, which the surface seats above the prompt.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Pin the token meter to the chat again',
    })
    void pin($)

    return next(e)
  })

  // A new tab's chat attaches after the session starts.
  on('session.attach', async ($, e, next) => {
    await pin($)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open(PANE_OPEN)

    return { text: 'Token meter pinned.' }
  })

  // The prompt row and its turn can arrive in either order: whichever comes
  // second links them.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    await $.state.set(PENDING, e.uuid)
    const a = await read($, active)
    if (a && !a.isLinked) await link($, e.uuid, a.turnId)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const { context } = await $.session.usage()
    // The session's fill counts the last response's input alone; the previous
    // turn's own figure adds that response's output, which is now context too.
    const prevId = await read($, latest)
    const prev = prevId
      ? await read($, memberOf(turns, { requestId: prevId }))
      : null
    const before =
      context.tokens !== undefined &&
      prev &&
      prev.calls > 0 &&
      prev.context >= context.tokens
        ? prev.context
        : (context.tokens ?? 0)
    await $.state.set(
      { plugin: 'token-meter', key: 'turns', id: e.turnId },
      {
        model: '',
        window: context.window,
        before,
        context: 0,
        input: 0,
        cached: 0,
        output: 0,
        live: 0,
        calls: 0,
        agents: 0,
        isRunning: true,
      },
    )
    // A continuation turn has no prompt of its own: born linked.
    await $.state.set(ACTIVE, { turnId: e.turnId, isLinked: e.text === '' })
    await $.state.set(LATEST, e.turnId)
    const p = await read($, pending)
    if (p && e.text !== '') await link($, p, e.turnId)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const turnId = isMain ? e.turnId : (await read($, active))?.turnId
    if (turnId === undefined) return yield* next(e)

    let chars = 0
    let written = 0
    try {
      for await (const chunk of next(e)) {
        if (chunk.kind === 'stop' && chunk.usage) {
          const u = chunk.usage
          const sent =
            u.input_tokens +
            u.cache_read_input_tokens +
            u.cache_creation_input_tokens
          await update($, memberOf(turns, { requestId: turnId }), v =>
            v && isMain
              ? {
                  ...v,
                  model: u.model,
                  context: sent + u.output_tokens,
                  input: v.input + sent,
                  cached: v.cached + u.cache_read_input_tokens,
                  output: v.output + u.output_tokens,
                  live: 0,
                  calls: v.calls + 1,
                }
              : v && { ...v, agents: v.agents + sent + u.output_tokens },
          )
        } else if (isMain) {
          if (chunk.kind === 'text' || chunk.kind === 'thinking') {
            chars += chunk.text.length
          } else if (chunk.kind === 'input') {
            chars += chunk.json.length
          }
          if (chars - written >= WRITE_EVERY_CHARS) {
            written = chars
            const live = Math.round(chars / CHARS_PER_TOKEN)
            await update(
              $,
              memberOf(turns, { requestId: turnId }),
              v => v && { ...v, live },
            )
          }
        }
        yield chunk
      }
    } finally {
      if (isMain && written > 0) {
        await update($, memberOf(turns, { requestId: turnId }), v =>
          v && v.live > 0 ? { ...v, live: 0 } : v,
        )
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    await update(
      $,
      memberOf(turns, { requestId: e.turnId }),
      v => v && { ...v, isRunning: false, live: 0 },
    )
    await update($, active, a => (a?.turnId === e.turnId ? null : a))
    await $.state.set(PENDING, null)

    return next(e)
  })

  // The bar under each prompt in the chat, redrawn as its turn's figures move.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const own = await next(e)
    const turnId = await read($, memberOf(links, e))
    const t = turnId ? await read($, memberOf(turns, { requestId: turnId })) : null
    if (!t) return own

    const els = $.ui.resolve(e)
    const { Box } = els

    return (
      <Box flexDirection="column">
        {own}
        {meter(els, t, BAR_PX)}
      </Box>
    )
  })

  // The pinned meter follows the latest prompt.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Text } = els
    const turnId = await read($, latest)
    const t = turnId ? await read($, memberOf(turns, { requestId: turnId })) : null
    if (!t) return <Text dimColor>No prompt measured yet.</Text>

    return meter(els, t, PANE_BAR_PX, true)
  })

  // While a turn runs, the spinner line carries the fill and the output so far.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const a = await read($, active)
    const t = a ? await read($, memberOf(turns, { requestId: a.turnId })) : null
    if (!t) return next(e)

    const live = `${percent(t)}% ctx · ${tokens(t.output + t.live)} out`

    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${live}` } })
  })
}
