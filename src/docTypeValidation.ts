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

import type { Moment } from 'moment';
import debug from 'debug';
import moment from 'moment';

import type { FlObject } from './types.js';
import { fromOadaType } from './conversions.js';

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');

// TODO:
//      3) Add in the overall expiration date into the array to be
//      reduced to a minimum expiration.
//      4) Consider taking the FL expiration if its the minimum in the
//      even that the expiration date is unlisted or something
//      5) Fix typescript issues...

/**
 * validates documents that have not yet been approved
 * @param {*} trellisDoc
 * @param {*} flMirror
 * @param {*} type
 * @returns
 */
export async function validateResult(
  trellisDocument: any,
  flMirror: FlObject,
  type: string,
) {
  info(`Validating pending doc [${trellisDocument._id}]; type: [${type}]`);
  try {
    const flType = fromOadaType(type)
      ?.name as unknown as keyof typeof validation;
    if (!flType || !validation[flType])
      throw new Error(`Validation of FL Type ${flType} unsupported`);
    return validation[flType](trellisDocument, flMirror);
  } catch (error_: unknown) {
    error({ error: error_ }, 'validateResult Errored');
    return {
      status: false,
      message: `validateResult Errored: ${(error_ as Error).message}`,
    };
  }
} // ValidateResult

// For multiple checks:
/*
    let messages: Array<string> = [];
    let statuses: Array<Boolean> = [];
    //Some check
    messages.push(message);
    statuses.push(status);

    return {
      message: messages.join('; '),
      status: statuses.filter(i=> i === undefined).some(i => !i)
    };
  */

const validation = {
  '100g Nutritional Information'(trellisDocument: any, flMirror: FlObject) {
    const trellisExpiration = moment(trellisDocument.expire_date).utcOffset(0);
    return validateExpiration(moment(trellisExpiration), flMirror);
  },
  /*
  'ACH Form': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Allergen Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Animal Welfare Audit': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Animal Welfare Corrective Actions': (trellisDoc: any, flMirror: FlObject) => {
  },
  'APHIS Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Bioengineered (BE) Ingredient Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Bisphenol A (BPA) Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Business License': (trellisDoc: any, flMirror: FlObject) => {
  },
  'California Prop 65 Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  */
  'Certificate of Insurance'(trellisDocument: any, flMirror: FlObject) {
    const trellisDates: any[] = Object.values(trellisDocument.policies).map(
      (object: any) => moment(object.expire_date).utcOffset(0),
    );
    return validateExpiration(trellisDates, flMirror);
  },
  /*
  'Co-Pack Confidentiality Agreement Form': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Co-Packer FSQA Questionnaire (GFSI Certified)': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Co-Packer FSQA Questionnaire (Non-GFSI Certified)': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Country of Origin Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Emergency Contact Information': (trellisDoc: any, flMirror: FlObject) => {
  },
  'E.Coli 0157:H7 Intervention Audit': (trellisDoc: any, flMirror: FlObject) => {
  },
  'E.Coli 0157:H7 Intervention Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Foreign Material Control Plan': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Humane Harvest Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'GFSI Audit': (trellisDoc: any, flMirror: FlObject) => {
  },
  'GFSI Certificate': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Gluten Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'GMO Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'HACCP Plan / Flow Chart': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Ingredient Breakdown Range %': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Letter of Guarantee': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Lot Code Explanation': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Master Service Agreement (MSA)': (trellisDoc: any, flMirror: FlObject) => {
  },
  'National Residue Program (NRP) Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Natural Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Non-Ambulatory (3D/4D) Animal Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Product Label': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Product Specification': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Pure Food Guaranty and Indemnification Agreement (LOG)': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Rate Sheet': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Safety Data Sheet (SDS)': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Small Business Administration (SBA) Form': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Specifications that indicate acceptable requirements': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Specified Risk Materials (SRM) Audit': (trellisDoc: any, flMirror: FlObject) => {
  },
  //This one wasn't accepted
  'Specified Risk Materials (SRM) Audit Corrective Actions': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Specified Risk Materials (SRM) Statement': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Third Party Food Safety GMP Audit': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Third Party Food Safety GMP Audit Corrective Actions': (trellisDoc: any, flMirror: FlObject) => {
  },
  'Third Party Food Safety GMP Certificate': (trellisDoc: any, flMirror: FlObject) => {
  },
  'W-8': (trellisDoc: any, flMirror: FlObject) => {
  },
  'W-9': (trellisDoc: any, flMirror: FlObject) => {
  },
  'WIRE Form': (trellisDoc: any, flMirror: FlObject) => {
  },
  */
};

function validateExpiration(
  trellisDates: Moment | Moment[],
  flMirror: FlObject,
) {
  let message = '';
  let status = true;
  const flExp = moment(flMirror.expirationDate).format('YYYY-MM-DD');
  let minimumExp: string;

  if (trellisDates && Array.isArray(trellisDates)) {
    // Filter out the common bad date from target of 1900-12-30
    trellisDates = trellisDates.filter(
      (index) => index.format('YYYY-MM-DD') !== '1900-12-30',
    );

    if (trellisDates.length > 0) {
      minimumExp = trellisDates
        .reduce(
          (previousExp, currentExp) =>
            previousExp < currentExp ? previousExp : currentExp,
          trellisDates[0]!,
        )
        .format('YYYY-MM-DD');
    } else throw new Error('Could not extract expiration dates from PDF.');
  } else {
    minimumExp = trellisDates.format('YYYY-MM-DD');
  }

  const now = moment().utcOffset(0);

  if (moment(flExp) > moment(minimumExp)) {
    message = `Expiration date submitted in Food Logiq (${flExp}) does not match the minimum expiration date found in the PDF document (${minimumExp}).`;
    status = false;
  }

  if (moment(minimumExp) <= now) {
    message = `Minimum expiration date found on the document indicates it is already expired: ${minimumExp}`;
    status = false;
  }

  if (message) info(message);
  return { message, status };
}

/*
Function validateEffective(trellisDoc: any, flMirror: FlObject) {
  let message: string;
  let status = true;
  let flEffective = moment(flMirror.shareSource.shareSpecificAttributes.effectiveDate).format('YYYY-MM-DD');
  let trellisEffective = moment(trellisDoc.effective_date).utcOffset(0).format('YYYY-MM-DD');
  if (!trellisEffective) {
    message = "Effective date missing from the PDF and is required to be present.";
    status = false;
  }
  return {message, status};
}
*/

export default {
  validateResult,
};
