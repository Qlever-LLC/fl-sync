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
import type { ReportConfig} from '@oada/jobs';

export const reportConfig: ReportConfig = {
  jobMappings: {
    'Document Name': 'config.name',
    'Document Type': 'config.type',
    'Creation Date': 'config.date',
    'Supplier Name': 'config.bname',
    'FoodLogiQ Status': 'foodlogiq.resultstatus',
    'Trellis Result': 'errorMappings',
    'Additional Information': 'result.message',
    'FoodLogiQ Link': 'config.link',
    'FoodLogiQ Business ID': 'config.bid',
    'FoodLogiQ Document ID': 'config.key'
  },
  errorMappings: {
    'associated-assessment-rejection': 'Assessment Failure',
    'bad-fl-attachments': 'Attachments could not be retrieved or are corrupt.',
    'document-validation': 'Document contents did not match FoodLogiQ data or were missing.',
    'multi-files-attached': 'Multiple attachments is not currently allowed for this document type.',
    'target-multiple-docs-combined': 'The PDF attachment contained multiple documents. This is currently unsupported.',
    'target-other': 'Extraction Failure',
    'target-unrecognized': 'Extraction Failure',
    'target-validation': 'Extraction Failure',
    'unknown': 'Other Errors',
    'target-error-already-approved': 'Document is already approved, but errored during extraction',
  },
}
