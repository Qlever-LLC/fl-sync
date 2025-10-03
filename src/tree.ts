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

/* eslint-disable sonarjs/no-duplicate-string */

import type { Tree } from "@oada/types/oada/tree/v1.js";

const docsTree = {
  _type: "application/vnd.oada.bookmarks.1+json",
  _rev: 0,
  trellisfw: {
    _type: "application/vnd.oada.trellisfw.1+json",
    _rev: 0,
    "unidentified-docs": {
      _type: "application/vnd.oada.trellisfw.documents.1+json",
      "*": {
        // Individual docs here
        _type: "application/vnd.oada.trellisfw.document.1+json",
        _rev: 0,
      },
    },
    documents: {
      _type: "application/vnd.oada.trellisfw.documents.1+json",
      "*": {
        // COIs, letters-of-guarantee, fsqa-audits, etc.
        _type: "application/vnd.oada.trellisfw.documents.1+json",
        "*": {
          // Individual docs here
          _type: "application/vnd.oada.trellisfw.document.1+json",
          _rev: 0,
        },
      },
    },
  },
} as const satisfies Tree;
export const tree: Tree = {
  bookmarks: {
    _type: "application/vnd.oada.bookmarks.1+json",
    _rev: 0,
    trellisfw: {
      _type: "application/vnd.oada.trellisfw.1+json",
      _rev: 0,
      "trading-partners": {
        _type: "application/vnd.oada.trading-partners.1+json",
        _rev: 0,
        "*": {
          _type: "application/vnd.oada.trading-partner.1+json",
          _rev: 0,
          shared: docsTree,
          bookmarks: docsTree,
        },
      },
      documents: {
        _type: "application/vnd.oada.trellisfw.1+json",
        _rev: 0,
      },
    },
    services: {
      _type: "application/vnd.oada.services.1+json",
      _rev: 0,
      "fl-sync": {
        _type: "application/vnd.oada.service.1+json",
        _rev: 0,
        monitors: {
          _type: "application/vnd.oada.service.1+json",
          "*": {
            _type: "application/vnd.oada.service.1+json",
            "*": {},
          },
        },
        jobs: {
          _type: "application/vnd.oada.service.jobs.1+json",
          "*": {
            _type: "application/vnd.oada.service.job.1+json",
            _rev: 0,
          },
        },
        "assessment-templates": {
          _type: "application/vnd.oada.trellisfw.1+json",
          _rev: 0,
          "*": {
            _type: "application/vnd.oada.trellisfw.1+json",
            _rev: 0,
          },
        },
        "process-queue": {
          _type: "application/vnd.oada.trellisfw.1+json",
          _rev: 0,
        },
        businesses: {
          _type: "application/vnd.oada.trellisfw.1+json",
          _rev: 0,
          "*": {
            _type: "application/vnd.oada.trellisfw.1+json",
            _rev: 0,
            assessments: {
              //              '_type': 'application/vnd.foodlogiq.documents.1+json',
              _type: "application/vnd.oada.trellisfw.1+json",
              _rev: 0,
              "*": {
                //                '_type': 'application/vnd.foodlogiq.document.1+json',
                _type: "application/vnd.oada.trellisfw.1+json",
                _rev: 0,
              },
            },
            documents: {
              //              '_type': 'application/vnd.foodlogiq.documents.1+json',
              _type: "application/vnd.oada.trellisfw.1+json",
              _rev: 0,
              "*": {
                //                '_type': 'application/vnd.foodlogiq.document.1+json',
                _type: "application/vnd.oada.trellisfw.1+json",
                _rev: 0,
              },
            },
            locations: {
              // '_type': 'application/vnd.foodlogiq.locations.1+json',
              _type: "application/vnd.oada.trellisfw.1+json",
              _rev: 0,
              "*": {
                // '_type': 'application/vnd.foodlogiq.location.1+json',
                _type: "application/vnd.oada.trellisfw.1+json",
                _rev: 0,
              },
            },
            products: {
              // '_type': 'application/vnd.foodlogiq.products.1+json',
              _type: "application/vnd.oada.trellisfw.1+json",
              _rev: 0,
              "*": {
                // '_type': 'application/vnd.foodlogiq.product.1+json',
                _type: "application/vnd.oada.trellisfw.1+json",
                _rev: 0,
              },
            },
          },
        },
        "incident-types": {
          _type: "application/vnd.oada.trellisfw.1+json",
          _rev: 0,
          "*": {
            _type: "application/vnd.oada.trellisfw.1+json",
            _rev: 0,
            incidents: {
              "*": {
                _type: "application/vnd.oada.trellisfw.1+json",
                _rev: 0,
              },
            },
          },
        },
      },
    },
  },
  // A hack to write to trading-partners bookmarks directly using their masterid resource id
  resources: {
    "*": {
      bookmarks: docsTree,
      shared: docsTree,
    },
  },
};

export default tree;
