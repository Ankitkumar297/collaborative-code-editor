import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from './languageDetection.js';

test('detects clear syntax for each supported language', () => {
  const examples = [
    ['python', 'def is_even(value):\n    return value % 2 == 0'],
    ['c', '#include <stdio.h>\nint main() { printf("hi"); }'],
    ['cpp', '#include <iostream>\nint main() { std::cout << "hi"; }'],
    ['java', 'public class Main { public static void main(String[] args) { System.out.println("hi"); } }'],
    ['typescript', 'interface User { name: string }\nconst user: User = { name: "A" };'],
    ['node', 'const path = require("path");\nconsole.log(process.argv);'],
    ['csharp', 'using System;\nclass Main { static void Main() { Console.WriteLine("hi"); } }'],
    ['javascript', 'const greeting = "hello";\nconsole.log(greeting);'],
  ];

  examples.forEach(([expected, code]) => {
    const currentLanguage = expected === 'python' ? 'javascript' : 'python';
    assert.equal(detectLanguage(code, currentLanguage), expected, code);
  });
});

test('keeps the current language for short or ambiguous snippets', () => {
  assert.equal(detectLanguage('const value = 1;', 'python'), null);
  assert.equal(detectLanguage('x = 1', 'javascript'), null);
  assert.equal(detectLanguage('   ', 'python'), null);
});

test('does not report a language change when the active language already matches', () => {
  assert.equal(detectLanguage('def is_even(value):\n    return True', 'python'), null);
});
