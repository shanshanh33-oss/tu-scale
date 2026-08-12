import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BROWSER_AI_INPUT_LIMITS,
  canUseDesktopAiService,
  getAiBackendLabel,
  getAiModelInputDimensions,
  getAiOutputMode,
  getAiRuntimeErrorMessage,
} from '../src/ai/runtimePolicy.js'

test('public websites cannot probe or call the desktop AI service', () => {
  assert.equal(canUseDesktopAiService({ protocol: 'https:', hostname: 'tu-scale.pages.dev' }), false)
  assert.equal(canUseDesktopAiService({ protocol: 'https:', hostname: 'example.com' }), false)
  assert.equal(canUseDesktopAiService({ protocol: 'file:', hostname: '' }), false)
})

test('only loopback web pages can use the desktop AI service', () => {
  assert.equal(canUseDesktopAiService({ protocol: 'http:', hostname: '127.0.0.1' }), true)
  assert.equal(canUseDesktopAiService({ protocol: 'http:', hostname: 'localhost' }), true)
  assert.equal(canUseDesktopAiService({ protocol: 'https:', hostname: '::1' }), true)
})

test('AI limits allow large safe-mode output while still blocking extreme tasks', () => {
  assert.deepEqual(BROWSER_AI_INPUT_LIMITS, { edge: 6000, pixels: 24_000_000 })
  assert.equal(getAiOutputMode(32_000_000), 'normal')
  assert.equal(getAiOutputMode(60_000_000), 'safe')
  assert.equal(getAiOutputMode(75_000_000), 'confirm')
  assert.equal(getAiOutputMode(88_000_000), 'blocked')
})

test('large source images are resized before the fixed 2x AI pass', () => {
  assert.deepEqual(
    getAiModelInputDimensions(6000, 4000, 10000, 6667),
    { width: 5000, height: 3333 },
  )
  assert.deepEqual(
    getAiModelInputDimensions(2000, 1500, 8000, 6000),
    { width: 2000, height: 1500 },
  )
})

test('backend labels and runtime failures remain distinct', () => {
  assert.match(getAiBackendLabel('server'), /桌面本地 AI 服务/)
  assert.match(getAiBackendLabel('webgpu'), /WebGPU/)
  assert.match(getAiBackendLabel('wasm'), /WASM/)
  assert.match(getAiRuntimeErrorMessage('AI_MODEL_LOAD_FAILED'), /模型加载失败/)
  assert.match(getAiRuntimeErrorMessage('AI_INFERENCE_FAILED'), /模型已加载.*推理失败/)
  assert.match(getAiRuntimeErrorMessage('AI_MEMORY_FAILED'), /内存不足/)
  assert.match(getAiRuntimeErrorMessage('AI_LOCAL_SERVICE_FAILED'), /桌面本地 AI 服务处理失败/)
})
