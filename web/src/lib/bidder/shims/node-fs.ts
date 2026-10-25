// node:fs for the browser: the only use on the bid path is an opt-in trace file, which a page never writes.
export function appendFileSync(): void {}
export default { appendFileSync };
