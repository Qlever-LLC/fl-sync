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

export interface TrellisCOI {
  _id: string;
  policies: {
    expire_date: string;
    cgl: GeneralLiability;
    al: AutoLiability;
    el: EmployersLiability;
    ul: UmbrellaLiability;
    wc: WorkersCompensation;
  };
}

export interface GeneralLiability {
  'type': 'Commercial General Liability';
  'each_occurrence': number;
  'general_aggregate': number;
  'products_-_compop_agg': number;
  'expire_date': string;
  'effective_date': string;
}

export interface AutoLiability {
  type: 'Automobile Liability';
  combined_single_limit: number;
  expire_date: string;
  effective_date: string;
}

export interface UmbrellaLiability {
  type: 'Umbrella Liability';
  each_occurrence: number | string;
  expire_date: string;
  effective_date: string;
}

export interface EmployersLiability {
  type: "Employers' Liability";
  el_each_accident: number | string;
  expire_date: string;
  effective_date: string;
}

export interface WorkersCompensation {
  type: "Worker's Compensation";
  effective_date: string;
  expire_date: string;
}


export interface FlAssessment {
  _id: string;
  state: string;
  assessmentTemplate: {
    _id: string;
  };
  sections: Array<{
    subsections: Array<{
      questions: Array<{
        productEvaluationOptions: {
          columns: Array<{
            type: string;
            acceptanceType: string;
            acceptanceValueBool?: boolean;
            acceptanceValueNumericPrimary: number;
            name: string;
            statisticsNumeric: {
              average: number;
            };
            statisticsCommon: {
              percentWithinTolerance: number;
            };
            _id: string;
          }>;
          answerRows: Array<{
            answers: Array<{
              column?: string;
              answerBool?: boolean;
              answerNumeric?: number;
            }>;
          }>;
        };
      }>;
    }>;
  }>;
}

export interface JobConfig {
  'fl-sync-type': 'document';
  '_rev': number;
  'type': string;
  'key': string;
  'bid': string;
  'masterid': string;
  'mirrorid': string;
  'bname': string;
  'name': string;
  'allow-rejection'?: boolean;
  'date': string;
  'status': string;
  'link': string;
}

export interface FlObject {
  name: string;
  _id: string;
  state: string;
  lastUpdate: {
    userId: string;
  };
  assessmentTemplate: {
    _id: string;
    name: string;
  };
  performedOnBusiness: {
    _id: string;
  };
  shareSource: {
    isDeleted: boolean;
    approvalInfo: {
      status: string;
      setBy: {
        _id: string;
      };
    };
    shareSpecificAttributes: {
      effectiveDate: string;
    };
    type: {
      name: string;
    };
    sourceBusiness: {
      name: string;
      _id: string;
      address: {
        addressLineOne: string;
        postalCode: string;
        city: string;
        region: string;
        country: string;
      };
    };
    draftVersionId: string | undefined;
  };
  expirationDate: string;
  versionInfo: {
    createdAt: string;
    createdBy: {
      _id: string;
      firstName: string;
      lastName: string;
    };
    currentVersionId: string;
    isCurrentVersion: boolean;
  };
  history: Record<string, FlDocHistoryItem[]>;
}

export interface FlBusiness {
  _id: string;
  auditors: any;
  business: {
    _id: string;
    address: {
      addressLineOne: string;
      addressLineThree: string;
      addressLineTwo: string;
      city: string;
      country: string;
      latLng: {
        latitude: number;
        longitude: number;
        warnings: any[];
      };
      postalCode: string;
      region: string;
    };
    email: string;
    heroURL: string;
    iconURL: string;
    name: string;
    phone: string;
    website: string;
  };
  buyers: Array<{
    _id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    phoneExt: string;
    mobile: string;
  }>;
  community: {
    _id: string;
    iconURL: string;
    name: string;
    replyToEmail: string;
  };
  createdAt: string;
  eventSubmissionStats: string | undefined;
  expirationDate: string | undefined;
  expiredRecently: boolean;
  expiredSoon: boolean;
  expires: boolean;
  hasExpiredEntities: boolean;
  hasExpiringEntities: boolean;
  internalId: string;
  locationGroup: {
    _id: string;
    name: string;
  };
  overallRating: number;
  productGroup: {
    _id: string;
    name: string;
  };
  ratings: Record<string, any>;
  status: string; // TODO: enum
  statusCategory: string; // TODO: enum
  statusSetAt: string;
  statusSetBy: string;
  todoCount: number;
  traceabilityOptions: any;
  updatedAt: string;
}

export interface FlDocHistoryItem {
  changedBy: {
    _id: string;
    firstName: string;
    lastName: string;
  };
  changedAt: string;
  fromName: string;
  toName: string;
  fromSupplierName: string;
  toSupplierName: string;
  comment: string;
  action: string;
  versionId: string | undefined;
  additionalInfo: any;
  visibleForSupplier: boolean;
}

export interface Link {
  _id: string;
  _rev?: number | string;
}

export interface JobUpdate {
  time: string;
  information?: string;
  error?: string;
  status: string;
}

export type Links = Record<string, Link>;

export interface TargetJob {
  _id: string;
  status: string;
  config: Record<string, any>;
  result: Record<string, Record<string, { _id: string }>> | any;
  updates: Record<string, any>;
}

export interface FlSyncJob {
  _id: string;
  oadaId: string;
  status: string;
  config: Record<string, any>;
  result: any;
  updates: Record<string, any>;
}

export interface OldTradingPartner {
  sapid?: string;
  id?: string;
  type?: string;
  source?: string;
  vendorid?: string;
  partnerid?: string;
  companycode?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  coi_emails: string;
  fsqa_emails: string;
  email: string;
  phone: string;
  foodlogiq: {
    _id: string;
  };
  bookmarks: {
    _id: string;
  };
  shared: {
    _id: string;
  };
  _id: string;
}