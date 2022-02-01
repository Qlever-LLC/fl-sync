let config = require('./config').default;
const axios = require('axios');
const _ = require('lodash');
const CO_ID = config.get('foodlogiq.community.owner.id');
const CO_NAME = config.get('foodlogiq.community.owner.name');
const ASSESSMENT_BID = config.ASSESSMENT_BID;
const ASSESSMENT_TEMPLATE_ID = config.get('foodlogiq.assessment-template.id');
const ASSESSMENT_TEMPLATE_NAME = config.get('foodlogiq.assessment-template.name');
const COMMUNITY_ID = config.get('foodlogiq.community.id');
const COMMUNITY_NAME = config.get('foodlogiq.community.name');
const CONCURRENCY = config.get('trellis.concurrency');
const FL_DOMAIN = config.get('foodlogiq.domain');
const FL_TOKEN = config.get('foodlogiq.token');
const debug = require('debug');
const info = debug('fl-sync:info');
const trace = debug('fl-sync:trace');
const error = debug('fl-sync:error');

let COI_ASSESSMENT_TEMPLATE_ID = null;

const AssessmentType = Object.freeze(
  { "SupplierAudit": "supplier_audit", },
  { "SupplierQuestionnaire": "supplier_questionnaire" },
  { "InternalAudit": "internal_audit" },
);

// TODO: need to polish this code
// left here for reference
let assessment_template = {
  "assessmentTemplate": {
    "_id": ASSESSMENT_TEMPLATE_ID,
    "name": ASSESSMENT_TEMPLATE_NAME
  },
  "availableInCommunity": {
    "community": {
      "_id": COMMUNITY_ID,
      "name": COMMUNITY_NAME
    },
    "communityOwnerBusiness": {
      "_id": CO_ID,
      "name": CO_NAME
    }
  },
  "initiatedByBusiness": {
    "_id": CO_ID,
    "name": CO_NAME
  },
  "performedOnBusiness": {
    "_id": "605249563a720a000e4154ad",
    "name": "Centricity Test"
  },

  "name": "Insurance Requirements",
  "type": AssessmentType.SupplierAudit
};

// TODO: need to polish this code
// left here for reference
let answer_content = {
  "_id": "6091a3bed4e9d21beb000001",
  "answers": [
    {
      "column": "606cc7eff8014707de000012",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc83bf8014788eb000013",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc860f801475f03000014",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "6091a7361b70862ee2000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606cc887f80147f255000015",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606f661d2914d0eaff000001",
      "answerText": null,
      "answerBool": null,
    },
    {
      "column": "606f664b2914d09a5f000002",
      "answerText": null,
      "answerNumeric": null
    }
  ]
};

/**
 * builds array of answers from "Certificate of Insurance (COI) Requirements" assessment template
 */
async function buildAnswerArrayFromAssessmentTemplate() {
  let answers = [];
  let _answer_content = _.cloneDeep(answer_content);
  if (COI_ASSESSMENT_TEMPLATE_ID !== null) {
    let coi_template = ASSESSMENT_TEMPLATES[COI_ASSESSMENT_TEMPLATE_ID];
    let columns = coi_template["sections"][0]["subsections"][0]["questions"][0]["productEvaluationOptions"]["columns"];
    if (typeof columns !== 'undefined') {
      columns.forEach((col) => {
        let answer_template = {
          "column": col._id,
          "answerText": null,
          "answerBool": null,
          "answerNumeric": 2000000
        };
        switch (col.type) {
          case "numeric":
            answer_template["answerNumeric"] = col["acceptanceValueNumericPrimary"];
            break;
          case "bool":
            answer_template["answerBool"] = true;
            answer_template["answerNumeric"] = col["acceptanceValueNumericPrimary"];
            break;
          default:
            error("type not defined for COI Assessment.");
            break;
        }
        answers.push(answer_template);
      });
    }//if #2
  }//if #1
  if (answers.length > 0)
    _answer_content["answers"] = answers;
  return _answer_content;
}//buildAnswerArrayFromAssessmentTemplate

/**
 * spawns and updates assessments automating the spawning process
 * @param bid business_id
 * @param general general liability insurance
 * @param aggregate general aggregate
 * @param auto auto liability
 * @param umbrella coverage
 * @param employer liability
 * @param worker compensation
 */
async function spawnAssessment(bid, bname, content) {
  let { general, aggregate, auto, product, umbrella, employer, worker, updateFlId } = content;
  let PATH_SPAWN_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/spawnedassessment`;
  let PATH_TO_UPDATE_ASSESSMENT = PATH_SPAWN_ASSESSMENT;
  let _assessment_template = _.cloneDeep(assessment_template);
  _assessment_template["performedOnBusiness"]["_id"] = bid;
  _assessment_template["performedOnBusiness"]["name"] = bname;

  //spawning the assessment with some (not all) values 
  let result = await axios({
    method: updateFlId ? "get" : "post",
    url: updateFlId ? `${PATH_SPAWN_ASSESSMENT}/${updateFlId}` : PATH_SPAWN_ASSESSMENT,
    headers: { 'Authorization': FL_TOKEN },
    data: _assessment_template
  }).catch((err) => {
    error("--> Error when spawning an assessment.");
    error(err);
    throw err;
  });

  //setting the assessment if to be modified
  let SPAWNED_ASSESSMENT_ID = result ? result.data._id : updateFlId;
  let ASSESSMENT_BODY = result.data;
  let answers_template = [];

  //populating answers in the COI assessment
  answer_content["answers"][0]["answerNumeric"] = general;
  answer_content["answers"][1]["answerNumeric"] = aggregate;
  answer_content["answers"][2]["answerNumeric"] = auto;
  answer_content["answers"][3]["answerNumeric"] = product;
  answer_content["answers"][4]["answerNumeric"] = umbrella;
  answer_content["answers"][5]["answerNumeric"] = employer;
  answer_content["answers"][6]["answerBool"] = worker;

  //including the answers in the answer array
  answers_template.push(answer_content);
  //attaching the answers into the assessment template body
  ASSESSMENT_BODY["sections"][0]["subsections"][0]["questions"][0]["productEvaluationOptions"]["answerRows"] = answers_template;
  // updating percentage completed
  ASSESSMENT_BODY["state"] = "In Progress";
  ASSESSMENT_BODY["questionInteractionCounts"]["answered"] = 1;
  ASSESSMENT_BODY["questionInteractionCounts"]["percentageCompleted"] = 100;
  // creating the path for a specific assessment (update/put)
  PATH_TO_UPDATE_ASSESSMENT = PATH_TO_UPDATE_ASSESSMENT + `/${SPAWNED_ASSESSMENT_ID}`;
  //updating assessment
  ASSESSMENT_BODY["state"] = "Submitted";
  let response = await updateAssessment(PATH_TO_UPDATE_ASSESSMENT, ASSESSMENT_BODY);
  return response || result
}//spawnAssessment

/**
 * fetches assessment templates from trellis
 * looks for COI "Certificate of Insurance (COI) Requirements" in particular
 */
async function fetchCOIAssessmentTemplateFromTrellis() {
  try {
    let _templates = [];
    let coi_template = await CONNECTION.get({
      path: `${SERVICE_PATH}/assessment-templates`,
    }).then(async (r) => {
      for (const key in r.data) {
        if (key[0] !== '_') {
          _templates.push(key);
        }
      }//for
      await Promise.map(_templates, async function (template) {
        await CONNECTION.get({
          path: `${SERVICE_PATH}/assessment-templates/${template}`,
        }).then((result) => {

          if (typeof result.data["food-logiq-mirror"]._id !== 'undefined') {
            ASSESSMENT_TEMPLATES[result.data["food-logiq-mirror"]._id] = result.data["food-logiq-mirror"];
            if (result.data["food-logiq-mirror"].name === "Certificate of Insurance (COI) Requirements") {
              COI_ASSESSMENT_TEMPLATE_ID = result.data["food-logiq-mirror"]._id;
            }//if #2
          }// if #1

        });
      });
    });
  } catch (err) {
    error("Error when fetching COI template from trellis.");
    error(err);
    throw err;
  }
}//fetchCOIAssessmentTemplateFromTrellis

/**
 * creates the links between assessments and documents 
 * @param bid business_id
 * @param assessment info 
 * @param document info 
 */
async function linkAssessmentToDocument(bid, assessment, doc) {
  let PATH_LINK_ASSESSMENT = `${FL_DOMAIN}/v2/businesses/${CO_ID}/links/assessment/${assessment._id}`;
  trace(`Creating FL Link from assessment [${assessment._id}] to document [${doc._id}]`)

  return axios({
    method: "post",
    url: PATH_LINK_ASSESSMENT,
    headers: { "Authorization": FL_TOKEN },
    data: [{
      "businessId": bid,
      "from": assessment,
      "linkType": "SOURCES",
      "linkTypeDisplay": "Sources",
      "to": doc,
    }]
  }).catch(err => {
    error(err);
  })
}// linkAssessmentToDocument

/** 
 * updates the content of a spawned assessment
 * @param path spawned assessment url 
 * @param data complete content of the assessment
 */
async function updateAssessment(path, data) {
  trace(`Updating assessment [${data._id}] after creation`);
  await axios({
    method: "put",
    url: path,
    headers: { 'Authorization': FL_TOKEN },
    data: data
  }).then((result) => {
    info("--> assessment created. ", result.data._id);
    return result;
  }).catch((err) => {
    error("--> Error when updating the assessment.");
    error(err);
    throw err;
  });
}//updateAssessment



module.exports = {
  linkAssessmentToDocument,
  assessment_template,
  answer_content,
  spawnAssessment,
}
