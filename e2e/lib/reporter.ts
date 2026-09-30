// Short stdout: the specs' own lines (ERROR / NOT RUN) and one summary line. Full details go to tmp/e2e/report.json.
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class ShortReporter implements Reporter {
  private lines: string[] = [];
  onStdOut(chunk: string | Buffer) {
    process.stdout.write(chunk);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.lines.push(`${result.status.toUpperCase()} ${test.parent.project()?.name} ${test.title} (${Math.round(result.duration / 1000)} s)`);
  }
  onEnd(result: FullResult) {
    for (const l of this.lines) console.log(l);
    console.log(`run ${result.status}; details in tmp/e2e/report.json`);
  }
}
