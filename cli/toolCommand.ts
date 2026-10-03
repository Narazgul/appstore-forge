import { readFile } from 'node:fs/promises'
import { TOOLS, runTool } from '../src/project/tools'
import { CliError } from './errors'
import { fileHost } from './tool'

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

/** `forge tool [name] --json …`: one tool call, its result as JSON on stdout. A refused call
 *  prints `{ "error": … }` too, so a caller reading stdout always gets JSON back. */
export async function toolCommand(opts: { projectDir: string; name: string | null; json?: string }) {
  if (!opts.name) {
    print({ tools: TOOLS.map(({ name, description, input }) => ({ name, description, input })) })
    return 0
  }
  let input: unknown = {}
  if (opts.json !== undefined) {
    const text = opts.json.startsWith('@') ? await readFile(opts.json.slice(1), 'utf8') : opts.json
    try {
      input = JSON.parse(text)
    } catch (err) {
      throw new CliError(`--json is not valid JSON: ${(err as Error).message}`, 1)
    }
  }
  try {
    print(await runTool(fileHost(opts.projectDir), opts.name, input))
    return 0
  } catch (err) {
    if (!(err instanceof Error)) throw err
    print({ error: err.message })
    return err instanceof CliError ? err.exitCode : 2
  }
}
