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

import config from './config.js';

import { default as axios } from 'axios';
import debug from 'debug';

import type { JsonObject } from '@oada/client';

import type { FlAssessment } from './mirrorWatch.js';

const CO_ID = config.get('foodlogiq.community.owner.id');
const CO_NAME = config.get('foodlogiq.community.owner.name');
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const ASSESSMENT_TEMPLATE_NAME = config.get(
  'foodlogiq.assessment-template.name',
);
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const COMMUNITY_NAME = config.get('foodlogiq.community.name');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');

const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');

interface AssessmentType {
  SupplierAudit: string;
  SupplierQuestionnaire: string;
  InternalAudit: string;
}

// eslint-disable-next-line @typescript-eslint/no-redeclare, @typescript-eslint/naming-convention
const AssessmentType: AssessmentType = Object.freeze({
  SupplierAudit: 'supplier_audit',
  SupplierQuestionnaire: 'supplier_questionnaire',
  InternalAudit: 'internal_audit',
});

// TODO: need to polish this code
// left here for reference
const ASSESSMENT_TEMPLATE = {
  assessmentTemplate: {
    _id: ASSESSMENT_TEMPLATE_ID,
    name: ASSESSMENT_TEMPLATE_NAME,
  },
  availableInCommunity: {
    community: {
      _id: COMMUNITY_ID,
      name: COMMUNITY_NAME,
    },
    communityOwnerBusiness: {
      _id: CO_ID,
      name: CO_NAME,
    },
  },
  initiatedByBusiness: {
    _id: CO_ID,
    name: CO_NAME,
  },
  performedOnBusiness: {
    _id: '605249563a720a000e4154ad',
    name: 'Centricity Test',
  },

  name: 'Insurance Requirements',
  type: AssessmentType.SupplierAudit,
};

interface Answer {
  column: string;
  // eslint-disable-next-line @typescript-eslint/ban-types
  answerText?: string | undefined | null;
  // eslint-disable-next-line @typescript-eslint/ban-types
  answerBool?: boolean | undefined | null;
  // eslint-disable-next-line @typescript-eslint/ban-types
  answerNumeric?: number | undefined | null;
}

interface AssessmentContent {
  general: number;
  aggregate: number;
  auto: number;
  product: number;
  umbrella: number;
  employer: number;
  worker: boolean;
  updateFlId?: string | void;
}

interface AnswerContent {
  _id: string;
  answers: Answer[];
}

/**
 * Spawns and updates assessments automating the spawning process
 * @param bid business_id
 * @param general general liability insurance
 * @param aggregate general aggregate
 * @param auto auto liability
 * @param umbrella coverage
 * @param employer liability
 * @param worker compensation
 */
export async function spawnAssessment(
  bid: string,
  bName: string,
  content: AssessmentContent,
) {
  const {
    general,
    aggregate,
    auto,
    product,
    umbrella,
    employer,
    worker,
    updateFlId,
  } = content;
  const PATH_SPAWN_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment`;
  let PATH_TO_UPDATE_ASSESSMENT = PATH_SPAWN_ASSESSMENT;
  const assessmentTemplate = structuredClone(ASSESSMENT_TEMPLATE);
  assessmentTemplate.performedOnBusiness._id = bid;
  assessmentTemplate.performedOnBusiness.name = bName;

  // Spawning the assessment with some (not all) values
  const result = await axios({
    method: updateFlId ? 'get' : 'post',
    url: updateFlId
      ? `${PATH_SPAWN_ASSESSMENT}/${updateFlId}`
      : PATH_SPAWN_ASSESSMENT,
    headers: { Authorization: FL_TOKEN },
    data: assessmentTemplate,
  }).catch((cError: unknown) => {
    error(cError, '--> Error when spawning an assessment.');
    throw cError as Error;
  });

  // Setting the assessment if to be modified
  const SPAWNED_ASSESSMENT_ID = result ? result.data._id : updateFlId;
  const ASSESSMENT_BODY = result.data;
  const answersTemplate = [];

  // Populating answers in the COI assessment
  // TODO: Do all of these others need to be null??
  const answerContent: AnswerContent = {
    _id: '6091a3bed4e9d21beb000001',
    answers: [
      {
        column: '606cc7eff8014707de000012',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: general,
      },
      {
        column: '606cc83bf8014788eb000013',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: aggregate,
      },
      {
        column: '606cc860f801475f03000014',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: auto,
      },
      {
        column: '6091a7361b70862ee2000001',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: product,
      },
      {
        column: '606cc887f80147f255000015',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: umbrella,
      },
      {
        column: '606f661d2914d0eaff000001',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerBool: null,
        answerNumeric: employer,
      },
      {
        column: '606f664b2914d09a5f000002',
        // eslint-disable-next-line unicorn/no-null
        answerText: null,
        // eslint-disable-next-line unicorn/no-null
        answerNumeric: null,
        answerBool: worker,
      },
    ],
  };

  // Including the answers in the answer array
  answersTemplate.push(answerContent);
  // Attaching the answers into the assessment template body
  ASSESSMENT_BODY.sections[0].subsections[0].questions[0].productEvaluationOptions.answerRows =
    answersTemplate;
  // Updating percentage completed
  ASSESSMENT_BODY.state = 'In Progress';
  ASSESSMENT_BODY.questionInteractionCounts.answered = 1;
  ASSESSMENT_BODY.questionInteractionCounts.percentageCompleted = 100;
  // Creating the path for a specific assessment (update/put)
  PATH_TO_UPDATE_ASSESSMENT += `/${SPAWNED_ASSESSMENT_ID}`;
  // Updating assessment
  ASSESSMENT_BODY.state = 'Submitted';
  const response = await updateAssessment(
    PATH_TO_UPDATE_ASSESSMENT,
    ASSESSMENT_BODY,
  );
  return response || result;
} // SpawnAssessment

/**
 * creates the links between assessments and documents
 * @param bid business_id
 * @param assessment info
 * @param doc info
 */
export async function linkAssessmentToDocument(
  bid: string,
  assessment: JsonObject,
  document: JsonObject,
) {
  const PATH_LINK_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/links/assessment/${assessment._id}`;
  trace(
    `Creating FL Link from assessment [${assessment._id}] to document [${document._id}]`,
  );

  return axios({
    method: 'post',
    url: PATH_LINK_ASSESSMENT,
    headers: { Authorization: FL_TOKEN },
    data: [
      {
        businessId: bid,
        from: assessment,
        linkType: 'SOURCES',
        linkTypeDisplay: 'Sources',
        to: document,
      },
    ],
  }).catch((cError: Error) => {
    error(cError);
  });
} // LinkAssessmentToDocument

/**
 * updates the content of a spawned assessment
 * @param path spawned assessment url
 * @param data complete content of the assessment
 */
async function updateAssessment(path: string, data: FlAssessment) {
  trace(`Updating assessment [${data._id}] after creation`);
  try {
    const result = await axios({
      method: 'put',
      url: path,
      headers: { Authorization: FL_TOKEN },
      data,
    });

    info('--> assessment created. ', result.data._id);
    return result;
  } catch (cError: unknown) {
    error({ error: cError }, '--> Error when updating the assessment.');
    error('Request was:', { url: path, data: JSON.stringify(data) });
    throw cError as Error;
  }
} // UpdateAssessment

export { ASSESSMENT_TEMPLATE as assessment_template };
