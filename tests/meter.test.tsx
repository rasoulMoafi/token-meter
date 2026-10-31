import { expect, test } from 'claude-code/testing'

const usage = {
  model: 'claude-opus-5-5',
  input_tokens: 1000,
  cache_read_input_tokens: 30000,
  cache_creation_input_tokens: 0,
  output_tokens: 600,
}

const ROW = {
  plugin: 'token-meter',
  component: 'UserMessage',
  requestId: 'p1',
  props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: false },
} as const

const PANE = {
  plugin: 'token-meter',
  component: 'Pane',
  requestId: 'token-meter',
  props: {
    title: 'Tokens',
    isFocused: false,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

test('a prompt row carries its turn bar, live while streaming', async ($, on) => {
  // Each hook here stands for the engine beneath the plugin.
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 20000, window: 200000 }, rateLimits: [] },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'x'.repeat(2000) }
    yield { kind: 'stop', stopReason: 'end_turn', usage }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'x'.repeat(2000),
      toolUses: [],
      stopReason: 'end_turn',
      usage,
    }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  // The turn starts before its prompt row is stored: the row links late.
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'p1',
  })

  let isFirst = true
  for await (const chunk of $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'opus',
    messageCount: 1,
  })) {
    if (isFirst && chunk.kind === 'text') {
      isFirst = false
      const ui = await $.ui.mount({ ...ROW, surface: 'vscode' })
      expect((await ui.find({ type: 'Text', text: /of 200k/ }))?.text).toBe(
        '● 10% of 200k · +0 this prompt · 0 in (0% cached) · 500 out~ · 0 calls',
      )
      await ui.unmount()
    }
  }
  await $.turn.complete({
    answer: '',
    durationMs: 10,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...ROW, surface })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /of 200k/ }))?.text).toBe(
      '16% of 200k · +11.6k this prompt · 31.0k in (97% cached) · 600 out · 1 call',
    )
    if (surface !== 'terminal') {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
    await ui.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /of 200k/ }))?.text).toBe(
      '16% of 200k · +11.6k this prompt · 31.0k in (97% cached) · 600 out · 1 call',
    )
    await pane.unmount()
  }
})

test('the next prompt counts from where the last answer left off', async ($, on) => {
  let fill = 20000
  let step = usage
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: fill, window: 200000 }, rateLimits: [] },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: step }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: step,
    }
  })

  const run = async (turnId: string) => {
    await $.turn.start({ text: 'hi', turnId })
    for await (const _ of $.turn.step({ turnId, index: 0, model: 'opus', messageCount: 1 })) {
      // drain
    }
    await $.turn.complete({
      answer: '',
      durationMs: 10,
      isAborted: false,
      turnId,
      reason: 'answer',
    })
  }

  await run('t1')
  // The session reports the last response's input alone: 31000, not 31600.
  fill = 31000
  step = { ...usage, input_tokens: 2000, cache_read_input_tokens: 31000, output_tokens: 400 }
  await run('t2')

  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await pane.find({ type: 'Text', text: /of 200k/ }))?.text).toBe(
    '17% of 200k · +1.8k this prompt · 33.0k in (94% cached) · 400 out · 1 call',
  )
  await pane.unmount()
})

test('a new tab pins the strip once its chat attaches', async ($, on) => {
  const opened: string[] = []
  let hasSurface = false
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('ui.open', (_, e) => {
    if (!hasSurface) return { deny: 'no-surface: no surface is attached' }
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  expect(opened).toEqual([])

  hasSurface = true
  await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
  expect(opened).toEqual(['token-meter'])
})

test('the pinned meter waits for a first prompt', async $ => {
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await pane.find({ type: 'Text' }))?.text).toBe('No prompt measured yet.')
  await pane.unmount()
})

test('a row with no turn is the engine own', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...ROW, requestId: 'other', surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /of 200k/ })).toBeUndefined()
  await ui.unmount()
})
