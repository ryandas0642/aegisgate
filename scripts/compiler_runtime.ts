import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
export function compilerRuntimePath(): string {
  const path = process.env.PATH || '';
  if (process.platform !== 'win32') return path;
  const binary = process.env.CXX
    ? dirname(process.env.CXX)
    : path.split(delimiter).find((directory) => existsSync(join(directory, 'g++.exe')));
  return binary ? binary + delimiter + path : path;
}
