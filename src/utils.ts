/**
 * @license
 * Copyright 2024 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export function groupBy<T>(items: T[], itemFunction: (it: T) => string) {
  const grouped : Record<string, T[]> = {};
  for (const item of items) {
    const key = itemFunction(item);
    grouped[key] ||= [];
    grouped[key].push(item);
  }

  return grouped;
}

export function minimumDate(a: string | undefined, b: string | undefined): string {
  if (a === undefined && b === undefined) throw new Error('Both dates undefined; no minimum')
  if (a === undefined && b !== undefined) return b;
  if (b === undefined && a !== undefined) return a;
  const aDate = new Date(a!);
  const bDate = new Date(b!);

  return aDate < bDate ? a! : b!
}

export function sum<
  T extends Record<K, string | number>,
  K extends string
>(
  a: T,
  b: T,
  key: K
): number {
  const aValue = typeof a[key] === 'number' ? a[key] : Number.parseInt(String(a[key]), 10);
  const bValue = typeof b[key] === 'number' ? b[key] : Number.parseInt(String(b[key]), 10);
  return (aValue || 0) + (bValue || 0);
}