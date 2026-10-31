# token-meter

A live token-usage bar for Claude Code, so you can watch how much of the context window each prompt uses while Claude works.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install token-meter --marketplace rasoulMoafi/token-meter
```

## Why it exists

Many packages, modules and plugins claim they make Claude use fewer tokens for the same task. token-meter lets you test those claims. It shows in real time how many tokens each prompt uses, so you can run the same task with and without a package and compare the numbers.

## Comparing two setups

1. Start a new Claude Code session without the package and give it the task.
2. Write down the numbers under that prompt: `+… this prompt`, `in`, `out` and `calls`.
3. Start another new session with the package turned on and give it the exact same task.
4. Compare the two bars. Fewer tokens added, less input or fewer calls means the package helped.

Start each run in a new session. Otherwise the earlier conversation makes every number bigger.

## Where it shows

- **Pinned strip above the prompt box.** Always shows the latest prompt. Closed it? Type `/tokens` to bring it back.
- **Under each of your messages** in the chat, so older prompts keep their numbers.
- **On the "working…" line** while Claude is running: fill % and tokens written so far.

In VS Code and the desktop app the bar is a small graphic; in the terminal it is drawn with block characters.

## Reading it

```
▓▓▓░░░░  19% of 1.0M · +5.2k this prompt · 380k in (99% cached) · 4.5k out · 2 calls
```

| Part | Meaning |
|---|---|
| Bar | Gray: context before this prompt. Colored: what this prompt added (green < 70%, amber 70–89%, red ≥ 90%). Faded: the reply still streaming. |
| `19% of 1.0M` | How full the context window is, out of the model's window size. |
| `+5.2k this prompt` | How much this prompt and its answer grew the conversation. |
| `380k in` | Everything Claude read, summed over every step. Each step rereads the whole conversation, so this is roughly conversation size × calls. |
| `(99% cached)` | The part of that reading served from the prompt cache, which is much cheaper. |
| `4.5k out` | Everything Claude wrote: answers, tool requests, thinking. Shows `~` while it is an estimate mid-stream. |
| `2 calls` | Model requests the prompt took: one, plus one per round of tool use. |
| `●` | Claude is still working on this prompt. |
| `subagents` | Tokens used by subagents, when there were any. |

Exact figures come from the API at the end of each call; between calls the output count is estimated from the streamed text (about 4 characters per token).
