/** 引擎核心测试：场景识别 / 协议归一化 / fail-loud 行为 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimize, diagnose, detectScene, extractJson, normalizeOptimize } from '../lib/engine.js'
import { PolyError } from '../lib/result.js'

/** mock 传输：回显 system 供断言，返回固定 JSON */
function mockLlm(/** @type {string} */ payload) {
  return { complete: async (/** @type {any} */ req) => { (/** @type {any} */ (mockLlm)).lastSystem = req.system; return payload } }
}
/** @type {any} */ (mockLlm).lastSystem = ''

const GOOD = JSON.stringify({
  scene: 'code', optimized: 'O', notes: [{ change: 'c', why: 'w' }],
  coverage: { '技术栈': 'kept' }, language: 'zh',
})

test('detectScene 全量回归', () => {
  const cases = [
    ['画一只猫', 'image'], ['帮我写个爬虫', 'code'], ['写一篇小红书文案', 'writing'],
    ['扮演角色帮我练面试', 'chat'], ['写个 python 函数计算斐波那契', 'code'],
    ['a cute cat painting, studio ghibli style', 'image'], ['总结这篇文章的中心思想', 'chat'],
    ['生成一张赛博朋克城市夜景 poster', 'image'], ['随便聊聊', 'chat'],
  ]
  for (const [t, want] of cases) assert.equal(detectScene(t), want, t)
})

test('optimize：mock 全链路 + scene 覆盖', async () => {
  const r = await optimize(mockLlm(GOOD), '帮我写个爬虫', {})
  assert.equal(r.scene, 'code')
  assert.equal(r.optimized, 'O')
  assert.equal(r.notes.length, 1)
  assert.equal(r.language, 'zh')
  assert.ok(String(/** @type {any} */ (mockLlm).lastSystem).includes('要素清单'))
})

test('optimize：空输入 fail loud', async () => {
  await assert.rejects(optimize(mockLlm(GOOD), '   '), (/** @type {any} */ e) => e instanceof PolyError && e.code === 'BAD_ARGS')
})

test('optimize：坏 JSON 输出 fail loud（含围栏与前后缀噪声）', async () => {
  await assert.rejects(optimize(mockLlm('让我想想…'), 'x'), (/** @type {any} */ e) => e.code === 'BAD_OUTPUT')
  const fenced = await optimize(mockLlm('```json\n' + GOOD + '\n```'), 'x')
  assert.equal(fenced.optimized, 'O')
  const noisy = await optimize(mockLlm('好的，结果如下：\n' + GOOD + '\n以上。'), 'x')
  assert.equal(noisy.optimized, 'O')
})

test('optimize：optimized 缺失 fail loud', async () => {
  await assert.rejects(
    optimize(mockLlm('{"scene":"code"}'), 'x'),
    (/** @type {any} */ e) => e.code === 'BAD_OUTPUT' && e.message.includes('optimized'))
})

test('scene 参数显式指定时不做识别', async () => {
  await optimize(mockLlm(GOOD), '帮我写个爬虫', { scene: 'image' })
  assert.ok(/** @type {any} */ (mockLlm).lastSystem.includes('image 提示词'))
})

test('diagnose：协议归一化与默认值', async () => {
  const d = await diagnose(mockLlm('{"scene":"image","score":88.4,"problems":[{"severity":"high","issue":"i","suggestion":"s"},{"severity":"x","issue":"i2"}]}'), '画一只猫')
  assert.equal(d.score, 88)
  assert.equal(d.problems.length, 2)
  assert.equal(d.problems[1].severity, 'mid') // 非法 severity 收敛为 mid
})

test('extractJson：截取最大对象', () => {
  assert.deepEqual(extractJson('prefix {"a":1} suffix'), { a: 1 })
  assert.throws(() => extractJson('no json'), (/** @type {any} */ e) => e.code === 'BAD_OUTPUT')
})

test('normalizeOptimize：notes 非法输入收敛', () => {
  const r = normalizeOptimize({ optimized: 'O', notes: 'x', coverage: null }, 'code')
  assert.deepEqual(r.notes, [])
  assert.deepEqual(r.coverage, {})
})
