/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import type { ValidationContext } from '../index';
import { GraphQLError } from '../../error';
import find from '../../jsutils/find';
import type {
  SelectionSet,
  Field,
  Argument,
  Directive
} from '../../language/ast';
import { FIELD, INLINE_FRAGMENT, FRAGMENT_SPREAD } from '../../language/kinds';
import { print } from '../../language/printer';
import {
  getNamedType,
  GraphQLObjectType,
  GraphQLInterfaceType,
} from '../../type/definition';
import type {
  GraphQLType,
  GraphQLNamedType,
  GraphQLFieldDefinition
} from '../../type/definition';
import { typeFromAST } from '../../utilities/typeFromAST';


export function fieldsConflictMessage(responseName: any, reason: any): string {
  return `Fields "${responseName}" conflict because ${reasonMessage(reason)}.`;
}

function reasonMessage(reason: ConflictReasonMessage): string {
  if (Array.isArray(reason)) {
    return reason.map(([ responseName, subreason ]) =>
      `subfields "${responseName}" conflict because ${reasonMessage(subreason)}`
    ).join(' and ');
  }
  return reason;
}

/**
 * Overlapping fields can be merged
 *
 * A selection set is only valid if all fields (including spreading any
 * fragments) either correspond to distinct response names or can be merged
 * without ambiguity.
 */
export function OverlappingFieldsCanBeMerged(context: ValidationContext): any {
  var comparedSet = new PairSet();

  function findConflicts(fieldMap): Array<Conflict> {
    var conflicts = [];
    Object.keys(fieldMap).forEach(responseName => {
      var fields = fieldMap[responseName];
      if (fields.length > 1) {
        for (var i = 0; i < fields.length; i++) {
          for (var j = i; j < fields.length; j++) {
            var conflict = findConflict(responseName, fields[i], fields[j]);
            if (conflict) {
              conflicts.push(conflict);
            }
          }
        }
      }
    });
    return conflicts;
  }

  function findConflict(
    responseName: string,
    pair1: [Field, GraphQLFieldDefinition],
    pair2: [Field, GraphQLFieldDefinition]
  ): ?Conflict {
    var [ ast1, def1 ] = pair1;
    var [ ast2, def2 ] = pair2;
    if (ast1 === ast2 || comparedSet.has(ast1, ast2)) {
      return;
    }
    comparedSet.add(ast1, ast2);

    var name1 = ast1.name.value;
    var name2 = ast2.name.value;
    if (name1 !== name2) {
      return [
        [ responseName, `${name1} and ${name2} are different fields` ],
        [ ast1, ast2 ]
      ];
    }

    var type1 = def1 && def1.type;
    var type2 = def2 && def2.type;
    if (type1 && type2 && !sameType(type1, type2)) {
      return [
        [ responseName, `they return differing types ${type1} and ${type2}` ],
        [ ast1, ast2 ]
      ];
    }

    if (!sameArguments(ast1.arguments || [], ast2.arguments || [])) {
      return [
        [ responseName, 'they have differing arguments' ],
        [ ast1, ast2 ]
      ];
    }

    if (!sameDirectives(ast1.directives || [], ast2.directives || [])) {
      return [
        [ responseName, 'they have differing directives' ],
        [ ast1, ast2 ]
      ];
    }

    var selectionSet1 = ast1.selectionSet;
    var selectionSet2 = ast2.selectionSet;
    if (selectionSet1 && selectionSet2) {
      var visitedFragmentNames = {};
      var subfieldMap = collectFieldASTsAndDefs(
        context,
        getNamedType(type1),
        selectionSet1,
        visitedFragmentNames
      );
      subfieldMap = collectFieldASTsAndDefs(
        context,
        getNamedType(type2),
        selectionSet2,
        visitedFragmentNames,
        subfieldMap
      );
      var conflicts = findConflicts(subfieldMap);
      if (conflicts.length > 0) {
        return [
          [ responseName, conflicts.map(([ reason ]) => reason) ],
          conflicts.reduce(
            (allFields, [ , fields ]) => allFields.concat(fields),
            [ ast1, ast2 ]
          )
        ];
      }
    }
  }

  return {
    SelectionSet: {
      // Note: we validate on the reverse traversal so deeper conflicts will be
      // caught first, for clearer error messages.
      leave(selectionSet) {
        var fieldMap = collectFieldASTsAndDefs(
          context,
          context.getParentType(),
          selectionSet
        );
        var conflicts = findConflicts(fieldMap);
        if (conflicts.length) {
          return conflicts.map(([ [ responseName, reason ], fields ]) =>
            new GraphQLError(
              fieldsConflictMessage(responseName, reason),
              fields
            )
          );
        }
      }
    }
  };
}

type Conflict = [ ConflictReason, Array<Field> ];
// Field name and reason.
type ConflictReason = [ string, ConflictReasonMessage ];
// Reason is a string, or a nested list of conflicts.
type ConflictReasonMessage = string | Array<ConflictReason>;

function sameDirectives(
  directives1: Array<Directive>,
  directives2: Array<Directive>
): boolean {
  if (directives1.length !== directives2.length) {
    return false;
  }
  return directives1.every(directive1 => {
    var directive2 = find(
      directives2,
      directive => directive.name.value === directive1.name.value
    );
    if (!directive2) {
      return false;
    }
    return sameArguments(
      directive1.arguments || [],
      directive2.arguments || []
    );
  });
}

function sameArguments(
  arguments1: Array<Argument>,
  arguments2: Array<Argument>
): boolean {
  if (arguments1.length !== arguments2.length) {
    return false;
  }
  return arguments1.every(argument1 => {
    var argument2 = find(
      arguments2,
      argument => argument.name.value === argument1.name.value
    );
    if (!argument2) {
      return false;
    }
    return sameValue(argument1.value, argument2.value);
  });
}

function sameValue(value1, value2) {
  return (!value1 && !value2) || print(value1) === print(value2);
}

function sameType(type1: GraphQLType, type2: GraphQLType) {
  return String(type1) === String(type2);
}


/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * Note: This is not the same as execution's collectFields because at static
 * time we do not know what object type will be used, so we unconditionally
 * spread in all fragments.
 */
function collectFieldASTsAndDefs(
  context: ValidationContext,
  parentType: ?GraphQLNamedType,
  selectionSet: SelectionSet,
  visitedFragmentNames?: {[key: string]: boolean},
  astAndDefs?: {[key: string]: Array<[Field, ?GraphQLFieldDefinition]>}
): {[key: string]: Array<[Field, ?GraphQLFieldDefinition]>} {
  var _visitedFragmentNames = visitedFragmentNames || {};
  var _astAndDefs = astAndDefs || {};
  for (var i = 0; i < selectionSet.selections.length; i++) {
    var selection = selectionSet.selections[i];
    switch (selection.kind) {
      case FIELD:
        var fieldName = selection.name.value;
        var fieldDef;
        if (parentType instanceof GraphQLObjectType ||
            parentType instanceof GraphQLInterfaceType) {
          fieldDef = parentType.getFields()[fieldName];
        }
        var responseName = selection.alias ? selection.alias.value : fieldName;
        if (!_astAndDefs[responseName]) {
          _astAndDefs[responseName] = [];
        }
        _astAndDefs[responseName].push([ selection, fieldDef ]);
        break;
      case INLINE_FRAGMENT:
        _astAndDefs = collectFieldASTsAndDefs(
          context,
          typeFromAST(context.getSchema(), selection.typeCondition),
          selection.selectionSet,
          _visitedFragmentNames,
          _astAndDefs
        );
        break;
      case FRAGMENT_SPREAD:
        var fragName = selection.name.value;
        if (_visitedFragmentNames[fragName]) {
          continue;
        }
        _visitedFragmentNames[fragName] = true;
        var fragment = context.getFragment(fragName);
        if (!fragment) {
          continue;
        }
        _astAndDefs = collectFieldASTsAndDefs(
          context,
          typeFromAST(context.getSchema(), fragment.typeCondition),
          fragment.selectionSet,
          _visitedFragmentNames,
          _astAndDefs
        );
        break;
    }
  }
  return _astAndDefs;
}

/**
 * A way to keep track of pairs of things when the ordering of the pair does
 * not matter. We do this by maintaining a sort of double adjacency sets.
 */
class PairSet {
  _data: Map<any, Set<any>>;

  constructor() {
    this._data = new Map();
  }

  has(a, b) {
    var first = this._data.get(a);
    return first && first.has(b);
  }

  add(a, b) {
    _pairSetAdd(this._data, a, b);
    _pairSetAdd(this._data, b, a);
  }
}

function _pairSetAdd(data, a, b) {
  var set = data.get(a);
  if (!set) {
    set = new Set();
    data.set(a, set);
  }
  set.add(b);
}
