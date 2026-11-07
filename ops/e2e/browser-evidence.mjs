// The guard must not skip safe diagnostics or leave network listeners installed.
export async function finishBrowserEvidence({
    assertSafe,
    timeline,
    failed,
    retain,
}) {
    let violation;
    try {
        assertSafe();
    } catch (error) {
        violation = error;
    }
    const trace = timeline.finish();
    try {
        if (failed || violation) await retain(trace);
    } finally {
        if (violation) throw violation;
    }
}
