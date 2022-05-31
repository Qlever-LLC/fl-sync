import debug from 'debug';
import type {FlAssessment} from './mirrorWatch.js'
import _ from 'lodash';

const info = debug('fl-sync:mirror-watch:info');


/**
 * checks assessment
 * @param {*} assessment
 * @returns
 */
export function checkAssessment(assessment: FlAssessment) {
  info(`Checking assessment ${assessment._id}`);

  let {_id} = assessment?.assessmentTemplate;

  if (checkAssessments.has(_id)) {
    return checkAssessments.get(_id)!(assessment);
  }
  let reasons : string[] = [];
  let failed = assessment.sections.map(section => {
    return section.subsections.map(subsection => {
      return subsection.questions.map(question => {
        return question.productEvaluationOptions.columns.map(column => {
          // Handle columns that aren't scored
          if (column.acceptanceType === "none") return false;
          let res = column.statisticsCommon.percentWithinTolerance < 100
          if (res) {
            let reason = `${column.name}(${column.statisticsNumeric.average}) did not meet the requirement (${column.acceptanceValueNumericPrimary})`
            info(`Assessment violation for id [${assessment._id}: ${reason}`)
            reasons.push(reason);
          }
          return res
        })
      })
    });
  }).flat(5).some(i => i)
  return {failed, reasons}
}//checkAssessment

const checkAssessments = new Map(Object.entries({
  /**
   * checks COI assessment
   * @param {*} assessment
   * @returns
   */
  '606cc945c8f60c000e53947f': (assessment: FlAssessment) => {
    let reasons : string[] = [];
    info(`Checking COI assessment ${assessment._id}`);
    let failed = assessment.sections.map(section => {
      return section.subsections.map(subsection => {
        return subsection.questions.map(question => {
          let umbrellaIdx = _.findIndex(question.productEvaluationOptions.columns, ['name', "Umbrella Coverage"]);
          let _id = question.productEvaluationOptions.columns[umbrellaIdx]!._id;
          let umbrella = _.findIndex(question.productEvaluationOptions.answerRows[0]!.answers, ["column", _id]);
          return question.productEvaluationOptions.columns.map((column) => {
            let value;
            let requirement;
            let umbCov;
            // Handle columns that aren't scored
            if (column.acceptanceType === "none") return false;
            // Check for policy coverage PLUS umbrella coverage
            if (column.statisticsCommon.percentWithinTolerance < 100 && column.name !== "Umbrella Coverage" && column.type === 'numeric') {
              let answerIdx = _.findIndex(question.productEvaluationOptions.answerRows[0]!.answers, ["column", column._id]);
              let value = question?.productEvaluationOptions?.answerRows?.[0]?.answers?.[answerIdx]?.answerNumeric;
              let umbCov = question?.productEvaluationOptions?.answerRows?.[0]?.answers?.[umbrella]?.answerNumeric;
              let requirement = column.acceptanceValueNumericPrimary;
              // if umbrella only pertains to specific insurance types
              //            if (types.Handling assessmentindexOf(column.name) > -1) {}
              if (value !== undefined && umbCov !== undefined && requirement !== undefined) {
                let result = (value + umbCov < requirement);
                if (result) {
                  let reason = `The sum of ${column.name}(${value}) and Umbrella Coverage(${umbCov}) => ${value + umbCov} does not meet the required coverage (${requirement})`;
                  info(`Assessment violation for id [${assessment._id}: ${reason}`)
                  reasons.push(reason);
                }
                return result
              } else return true
            }
            let res = column.statisticsCommon.percentWithinTolerance < 100
            if (res) {
              if (column.type === "numeric") {
                let reason = `${column.name}(${value}; plus umbrella ${umbCov}) did not meet the requirement (${requirement})`
                info(`Assessment violation for id [${assessment._id}: ${reason}`)
                reasons.push(reason);
              } else if (column.type === "bool") {
                let answerIdx = _.findIndex(question.productEvaluationOptions.answerRows[0]!.answers, ["column", column._id]);
                let value = question?.productEvaluationOptions?.answerRows?.[0]?.answers?.[answerIdx]?.answerBool;
                let reason = `${column.name}(${value}) did not meet the requirement (${column.acceptanceValueBool})`
                info(`Assessment violation for id [${assessment._id}: ${reason}`)
                reasons.push(reason);
              }
            }
            return column.statisticsCommon.percentWithinTolerance < 100
          })
        })
      })
    })
    let thing = failed.flat(5)
    return {failed: thing.some(i => i), reasons}
  }
}));

export default checkAssessment;