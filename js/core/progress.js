// progress.js — 読み終えた章とテストの結果を、この端末の中だけに覚えておきます。
//
// 外には一切送りません。保存できない設定のブラウザでも、ページは普通に動きます。

const KEY = 'ocio-basics:progress:v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {}; // プライベートウィンドウなどで読めない場合
  }
}

function write(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

/** 保存が使えるかどうか。使えないときは UI から「保存されません」と伝えます。 */
export function isAvailable() {
  try {
    const probe = KEY + ':probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch (e) {
    return false;
  }
}

export function markRead(chapterId) {
  const p = read();
  p.read = p.read || {};
  p.read[chapterId] = Date.now();
  write(p);
}

export function isRead(chapterId) {
  const p = read();
  return !!(p.read && p.read[chapterId]);
}

export function readChapters() {
  const p = read();
  return Object.keys(p.read || {});
}

export function saveQuiz(result) {
  const p = read();
  p.quiz = { ...result, at: Date.now() };
  write(p);
}

export function loadQuiz() {
  return read().quiz || null;
}

export function saveTaskState(taskId, state) {
  const p = read();
  p.tasks = p.tasks || {};
  p.tasks[taskId] = state;
  write(p);
}

export function loadTaskState(taskId) {
  const p = read();
  return (p.tasks || {})[taskId] || null;
}

/** 保存した内容をすべて消します。設定ページのボタンから呼びます。 */
export function clearAll() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (e) {
    return false;
  }
}
