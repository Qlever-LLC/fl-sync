/**
 * @license
 * Copyright 2022 Qlever LLC
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

declare module 'convict-format-with-moment' {
  import type { Format } from 'convict';
  export const duration: Format;
}

declare module 'es-main' {
  export default function (value: unknown): boolean;
}

declare module 'csvjson' {
  import type { JsonValue } from 'type-fest';
  export type JsonRow<K extends string, V extends JsonValue> = Record<K, V>;
  export type JsonCsv<K = string, V = JsonValue> = Array<JsonRow<K, V>>;
  export function toCSV<K = string, V = JsonValue>(
    json: string | JsonCsv<K, V>,
    options?: {
      /** @default ',' */
      delimiter?: string;
      /** @default false */
      wrap?: string | boolean;
      headers?: 'full' | 'none' | 'relative' | 'key';
      /** @default '.' */
      objectDenote?: string;
      /** @default '[]' */
      arrayDenote?: string;
    }
  ): string;
}
