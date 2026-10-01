import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('event deadlines keep Taiwan time across browser timezones and legacy SQL timestamps', () => {
    const moduleUrl = new URL('../src/utils/datetime.js', import.meta.url).href
    const script = `
        import { formatTaipeiDateTime as format } from ${JSON.stringify(moduleUrl)};
        console.log(JSON.stringify([
            format('2026-10-13T15:59:00.000Z'),
            format('2026-10-13T16:00:00Z'),
            format('2026-10-13 23:59:00'),
            format('2026-10-13T23:59:00+08:00'),
            format('2026-10-13'),
            format(null, { fallback: '未設定' }),
            format('invalid', { fallback: '時間待更新' }),
        ]));
    `
    for (const TZ of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            env: { ...process.env, TZ }, encoding: 'utf8',
        })
        assert.deepEqual(JSON.parse(output), [
            '2026/10/13 23:59', '2026/10/14 00:00', '2026/10/13 23:59',
            '2026/10/13 23:59', '2026/10/13', '未設定', '時間待更新',
        ], TZ)
    }
})
