import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TITLE_TEMPLATE,
  formatTitle,
  composeTitle,
  stripLeadingCommand,
  buildFallbackTitle,
} from '../src/host/rules.ts';

test('formatTitle expands date tokens and handles type/topic segments', () => {
  const date = new Date(2025, 8, 13, 15, 30, 45); // Sept 13 2025 15:30:45

  // Standard template: {MMDD}｜{type}｜{topic}
  const title1 = formatTitle(DEFAULT_TITLE_TEMPLATE, date, '排查', '登录失败');
  assert.equal(title1, '0913｜排查｜登录失败');

  // Empty type drops the segment and adjacent separator
  const title2 = formatTitle(DEFAULT_TITLE_TEMPLATE, date, '', '登录失败');
  assert.equal(title2, '0913｜登录失败');

  // Empty topic drops the segment and trailing separator
  const title3 = formatTitle(DEFAULT_TITLE_TEMPLATE, date, '排查', '');
  assert.equal(title3, '0913｜排查');

  // Custom template with YYYYMMDD and HHmmss
  const title4 = formatTitle('{YYYYMMDD} [{type}] {topic}', date, 'Feature', 'Auth');
  assert.equal(title4, '20250913 [Feature] Auth');
});

test('stripLeadingCommand removes leading slash commands', () => {
  assert.equal(stripLeadingCommand('/retitle something'), 'something');
  assert.equal(stripLeadingCommand('/compact hello world'), 'hello world');
  assert.equal(stripLeadingCommand('plain message'), 'plain message');
});

test('composeTitle normalizes topic and respects maxBytes', () => {
  const date = new Date(2025, 8, 13, 10, 0, 0);
  const format = { template: DEFAULT_TITLE_TEMPLATE, maxBytes: 80 };
  const res = composeTitle(date, '排查', '超长标题测试   带有空格和换行\n\n', format);
  assert.ok(res.startsWith('0913｜排查｜超长标题测试 带有空格和换行'));
  assert.ok(Buffer.byteLength(res, 'utf8') <= 80);
});

test('buildFallbackTitle builds local fallback when messages are provided', () => {
  const date = new Date(2025, 8, 15, 10, 0, 0);
  const format = { template: DEFAULT_TITLE_TEMPLATE, maxBytes: 80 };
  const messages = [
    { seq: 1, text: '帮助我分析一下登录失败的日志' }
  ];
  const title = buildFallbackTitle(messages, format, date);
  assert.ok(title.startsWith('0915｜帮助我分析一下登录失败的日志'));
});
