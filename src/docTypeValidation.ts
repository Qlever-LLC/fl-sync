import moment, {Moment} from 'moment';
import debug from 'debug';
import type {FlObject} from './mirrorWatch.js';
import {fromOadaType} from './conversions.js';

const info = debug('fl-sync:mirror-watch:info');
const error = debug('fl-sync:mirror-watch:error');

//TODO:
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
export async function validateResult(trellisDoc: any, flMirror: FlObject, type: string) {
  info(`Validating pending doc [${trellisDoc._id}]; type: [${type}]`);
  try {
    let flType = (fromOadaType(type))!.name as unknown as keyof typeof validation;
    if (!flType || !validation[flType]) throw new Error(`Validation of FL Type ${flType} unsupported`);
    return validation[flType](trellisDoc, flMirror);
    } catch(err: any) {
    error('validateResult Errored: ', err);
    return {
      status: false,
      message: `validateResult Errored: ` + err.message
    }
  }
}//validateResult

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


let validation = {
  '100g Nutritional Information': (trellisDoc: any, flMirror: FlObject) => {
    let trellisExpiration = moment(trellisDoc.expire_date).utcOffset(0);
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
  'Certificate of Insurance': (trellisDoc: any, flMirror: FlObject) => {
    //@ts-ignore
    let trellisDates: any[] = Object.values(trellisDoc.policies)
      .map((obj:any) => moment(obj.expire_date).utcOffset(0))
    //@ts-ignore
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
  'Pure Food Guaranty and Indemnification Agr6284fa41f9c461000ffd19cfeement (LOG)': (trellisDoc: any, flMirror: FlObject) => {
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
}

function validateExpiration(trellisDates: Moment | Array<Moment>, flMirror: FlObject) {
  let message = '';
  let status = true;
  let flExp = moment(flMirror.expirationDate).format('YYYY-MM-DD');
  let minimumExp : string;


  if (trellisDates && Array.isArray(trellisDates)) {
    // Filter out the common bad date from target of 1900-12-30
    trellisDates = trellisDates.filter(i => i.format('YYYY-MM-DD') !== '1900-12-30')

    if (trellisDates.length > 0) {
      //@ts-ignore
      minimumExp = trellisDates.reduce(
      //@ts-ignore
        (prevExp, currentExp) => prevExp < currentExp ? prevExp : currentExp,
        trellisDates[0]
      ).format('YYYY-MM-DD');
    } else throw new Error('Could not extract expiration dates from PDF.')
  } else {
    minimumExp = trellisDates.format('YYYY-MM-DD');
  }
  let now = moment().utcOffset(0);

  if (moment(flExp) > moment(minimumExp)) {
    message = `Expiration date submitted in Food Logiq (${flExp}) does not match the minimum expiration date found in the PDF document (${minimumExp}).`;
    status = false;
  }
  if (moment(minimumExp) <= now) {
    message = `Minimum expiration date found on the document indicates it is already expired: ${minimumExp}`;
    status = false;
  }

  if (message) info(message);
  return {message, status}
}

/*
function validateEffective(trellisDoc: any, flMirror: FlObject) {
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
}