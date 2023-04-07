/**
 * @license
 *  Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import debug from 'debug';
import findIndex from 'lodash.findindex';

import type { FlAssessment } from './mirrorWatch.js';

const info = debug('fl-sync:mirror-watch:info');

/**
 * Checks assessment
 * @param {*} assessment
 * @returns
 */
export function checkAssessment(assessment: FlAssessment) {
  info(`Checking assessment ${assessment._id}`);

  const { _id } = assessment?.assessmentTemplate ?? {};

  if (checkAssessments.has(_id)) {
    return checkAssessments.get(_id)!(assessment);
  }

  const reasons: string[] = [];
  const failed = assessment.sections
    .map((section) =>
      section.subsections.map((subsection) =>
        subsection.questions.map((question) =>
          question.productEvaluationOptions.columns.map((column) => {
            // Handle columns that aren't scored
            if (column.acceptanceType === 'none') return false;
            const res = column.statisticsCommon.percentWithinTolerance < 100;
            if (res) {
              const reason = `${column.name}(${column.statisticsNumeric.average}) did not meet the requirement (${column.acceptanceValueNumericPrimary})`;
              info(`Assessment violation for id [${assessment._id}: ${reason}`);
              reasons.push(reason);
            }

            return res;
          })
        )
      )
    )
    .flat(5)
    .some(Boolean);
  return { failed, reasons };
} // CheckAssessment

const checkAssessments = new Map(
  Object.entries({
    /**
     * Checks COI assessment
     * @param {*} assessment
     * @returns
     */
    '606cc945c8f60c000e53947f'(assessment: FlAssessment) {
      const reasons: string[] = [];
      info(`Checking COI assessment ${assessment._id}`);
      const failed = assessment.sections.map((section) =>
        section.subsections.map((subsection) =>
          subsection.questions.map((question) => {
            const umbrellaIndex = findIndex(
              question.productEvaluationOptions.columns,
              ['name', 'Umbrella Coverage']
            );
            const { _id } =
              question.productEvaluationOptions.columns[umbrellaIndex]!;
            const umbrella = findIndex(
              question.productEvaluationOptions.answerRows[0]!.answers,
              ['column', _id]
            );
            return question.productEvaluationOptions.columns.map((column) => {
              let value;
              let requirement;
              let umbCov;
              // Handle columns that aren't scored
              if (column.acceptanceType === 'none') return false;
              // Check for policy coverage PLUS umbrella coverage
              if (
                column.statisticsCommon.percentWithinTolerance < 100 &&
                column.name !== 'Umbrella Coverage' &&
                column.type === 'numeric'
              ) {
                const answerIndex = findIndex(
                  question.productEvaluationOptions.answerRows[0]!.answers,
                  ['column', column._id]
                );
                const value =
                  question?.productEvaluationOptions?.answerRows?.[0]
                    ?.answers?.[answerIndex]?.answerNumeric;
                const umbCov =
                  question?.productEvaluationOptions?.answerRows?.[0]
                    ?.answers?.[umbrella]?.answerNumeric;
                const requirement = column.acceptanceValueNumericPrimary;
                // If umbrella only pertains to specific insurance types
                //            if (types.Handling assessmentindexOf(column.name) > -1) {}
                if (
                  value !== undefined &&
                  umbCov !== undefined &&
                  requirement !== undefined
                ) {
                  const result = value + umbCov < requirement;
                  if (result) {
                    const reason = `The sum of ${
                      column.name
                    }(${value}) and Umbrella Coverage(${umbCov}) was ${
                      value + umbCov
                    }. This does not meet the required coverage (${requirement})`;
                    info(
                      `Assessment violation for id [${assessment._id}: ${reason}`
                    );
                    reasons.push(reason);
                  }

                  return result;
                }

                return true;
              }

              const res = column.statisticsCommon.percentWithinTolerance < 100;
              if (res) {
                if (column.type === 'numeric') {
                  const reason = `${column.name}(${value}; plus umbrella ${umbCov}) did not meet the requirement (${requirement})`;
                  info(
                    `Assessment violation for id [${assessment._id}: ${reason}`
                  );
                  reasons.push(reason);
                } else if (column.type === 'bool') {
                  const answerIndex = findIndex(
                    question.productEvaluationOptions.answerRows[0]!.answers,
                    ['column', column._id]
                  );
                  const value =
                    question?.productEvaluationOptions?.answerRows?.[0]
                      ?.answers?.[answerIndex]?.answerBool;
                  const reason = `${column.name}(${value}) did not meet the requirement (${column.acceptanceValueBool})`;
                  info(
                    `Assessment violation for id [${assessment._id}: ${reason}`
                  );
                  reasons.push(reason);
                }
              }

              return column.statisticsCommon.percentWithinTolerance < 100;
            });
          })
        )
      );
      const thing = failed.flat(5);
      return { failed: thing.some(Boolean), reasons };
    },
  })
);

export default checkAssessment;
