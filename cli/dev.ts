export type DevOptions = { projectDir: string; setId: string; port: number }

export async function devCommand(_opts: DevOptions): Promise<void> {
  throw new Error('dev is built in the next task')
}
