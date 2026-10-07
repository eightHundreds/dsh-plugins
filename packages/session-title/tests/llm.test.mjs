import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMessageLang,
  normalizeType,
  parseTitleLine,
  parseTitleOutput,
  toSummary,
  buildPromptInput,
} from '../src/host/llm.ts';

test('detectMessageLang distinguishes Chinese from Latin messages', () => {
  const zhMessages = [{ seq: 1, text: '你好，请帮我写一个测试脚本' }];
  assert.equal(detectMessageLang(zhMessages), 'zh');

  const enMessages = [{ seq: 1, text: 'Hello, please help me write a unit test script for this library' }];
  assert.equal(detectMessageLang(enMessages), 'en');
});

test('normalizeType extracts and cleans up type tokens according to target language', () => {
  assert.equal(normalizeType('排查', 'zh'), '排查');
  assert.equal(normalizeType('  调试Bug  ', 'zh'), '调试');
  assert.equal(normalizeType('Debug', 'en'), 'Debug');
  assert.equal(normalizeType('  Refactoring  ', 'en'), 'Refactoring');
});

test('parseTitleLine parses single line type|topic correctly', () => {
  const parsed1 = parseTitleLine('排查|登录失败', 'zh');
  assert.equal(parsed1.type, '排查');
  assert.equal(parsed1.topic, '登录失败');

  const parsed2 = parseTitleLine('Debug｜Session error', 'en');
  assert.equal(parsed2.type, 'Debug');
  assert.equal(parsed2.topic, 'Session error');

  const parsed3 = parseTitleLine('纯主题没有类型', 'zh');
  assert.equal(parsed3.type, '');
  assert.equal(parsed3.topic, '纯主题没有类型');
});

test('parseTitleOutput handles labeled output and fallback structures', () => {
  // Labeled Chinese output
  const outputZh = `主线：开发登录模块\n类型：排查｜主题：处理 401 报错`;
  const resZh = parseTitleOutput(outputZh, 'zh');
  assert.equal(resZh.mainLine, '开发登录模块');
  assert.equal(resZh.type, '排查');
  assert.equal(resZh.topic, '处理 401 报错');

  // Labeled English output
  const outputEn = `Main line: Build authentication\nType: Debug\nTopic: Handle 401 error`;
  const resEn = parseTitleOutput(outputEn, 'en');
  assert.equal(resEn.mainLine, 'Build authentication');
  assert.equal(resEn.type, 'Debug');
  assert.equal(resEn.topic, 'Handle 401 error');

  // Two bare lines: first main line, second title line
  const outputBare = `重构数据层\n优化|提升查询性能`;
  const resBare = parseTitleOutput(outputBare, 'zh');
  assert.equal(resBare.mainLine, '重构数据层');
  assert.equal(resBare.type, '优化');
  assert.equal(resBare.topic, '提升查询性能');
});

test('buildPromptInput constructs incremental rolling state payload', () => {
  const state = {
    mainLine: '开发用户中心',
    summary: '排查|处理 401',
    seenCount: 1,
  };
  const messages = [
    { seq: 1, text: '第一条消息：我们要开发一个用户中心' },
    { seq: 2, text: '第二条消息：登录接口报错 401' },
    { seq: 3, text: '第三条消息：检查 JWT Token 解析' },
  ];
  const prompt = buildPromptInput(state, messages, 4096);
  assert.ok(prompt.includes('开发用户中心'));
  assert.ok(prompt.includes('排查|处理 401'));
  assert.ok(prompt.includes('检查 JWT Token 解析'));
});
