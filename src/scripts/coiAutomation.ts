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

import {
  //draftsToAwaitingApproval,
  gatherCoisReportData,
  generateCoisReport,
} from "../assessments/coi.js";

//const filename = 'cois-12-04-2024.json';
const filename = "CoiReportData.json";
const xlsxFilename = `cois-report-${new Date().toISOString()}.xlsx`;
try {
  //await draftsToAwaitingApproval();
  const reportDataSave = await gatherCoisReportData(filename);
  await generateCoisReport(reportDataSave, xlsxFilename);
} catch (err) {
  throw err;
}
