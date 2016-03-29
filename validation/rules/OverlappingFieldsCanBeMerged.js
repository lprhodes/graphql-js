'use strict';

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; })();
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fieldsConflictMessage = fieldsConflictMessage;
exports.OverlappingFieldsCanBeMerged = OverlappingFieldsCanBeMerged;

var _index = require('../index');

var _error = require('../../error');

var _find = require('../../jsutils/find');

var _find2 = _interopRequireDefault(_find);

var _ast = require('../../language/ast');

var _kinds = require('../../language/kinds');

var _printer = require('../../language/printer');

var _definition = require('../../type/definition');

var _typeComparators = require('../../utilities/typeComparators');

var _typeFromAST = require('../../utilities/typeFromAST');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function fieldsConflictMessage(responseName, reason) {
  return 'Fields "' + responseName + '" conflict because ' + reasonMessage(reason) + '.';
}

function reasonMessage(reason) {
  if (Array.isArray(reason)) {
    return reason.map(function (_ref) {
      var _ref2 = _slicedToArray(_ref, 2);

      var responseName = _ref2[0];
      var subreason = _ref2[1];
      return 'subfields "' + responseName + '" conflict because ' + reasonMessage(subreason);
    }).join(' and ');
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
function OverlappingFieldsCanBeMerged(context) {
  var comparedSet = new PairSet();

  function findConflicts(fieldMap) {
    var conflicts = [];
    Object.keys(fieldMap).forEach(function (responseName) {
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

  function findConflict(responseName, field1, field2) {
    var _field = _slicedToArray(field1, 3);

    var parentType1 = _field[0];
    var ast1 = _field[1];
    var def1 = _field[2];

    var _field2 = _slicedToArray(field2, 3);

    var parentType2 = _field2[0];
    var ast2 = _field2[1];
    var def2 = _field2[2];

    // Not a pair.

    if (ast1 === ast2) {
      return;
    }

    // If the statically known parent types could not possibly apply at the same
    // time, then it is safe to permit them to diverge as they will not present
    // any ambiguity by differing.
    // It is known that two parent types could never overlap if they are
    // different Object types. Interface or Union types might overlap - if not
    // in the current state of the schema, then perhaps in some future version,
    // thus may not safely diverge.
    if (parentType1 !== parentType2 && parentType1 instanceof _definition.GraphQLObjectType && parentType2 instanceof _definition.GraphQLObjectType) {
      return;
    }

    // Memoize, do not report the same issue twice.
    if (comparedSet.has(ast1, ast2)) {
      return;
    }
    comparedSet.add(ast1, ast2);

    var name1 = ast1.name.value;
    var name2 = ast2.name.value;
    if (name1 !== name2) {
      return [[responseName, name1 + ' and ' + name2 + ' are different fields'], [ast1], [ast2]];
    }

    var type1 = def1 && def1.type;
    var type2 = def2 && def2.type;
    if (type1 && type2 && !(0, _typeComparators.isEqualType)(type1, type2)) {
      return [[responseName, 'they return differing types ' + type1 + ' and ' + type2], [ast1], [ast2]];
    }

    if (!sameArguments(ast1.arguments || [], ast2.arguments || [])) {
      return [[responseName, 'they have differing arguments'], [ast1], [ast2]];
    }

    var selectionSet1 = ast1.selectionSet;
    var selectionSet2 = ast2.selectionSet;
    if (selectionSet1 && selectionSet2) {
      var visitedFragmentNames = {};
      var subfieldMap = collectFieldASTsAndDefs(context, (0, _definition.getNamedType)(type1), selectionSet1, visitedFragmentNames);
      subfieldMap = collectFieldASTsAndDefs(context, (0, _definition.getNamedType)(type2), selectionSet2, visitedFragmentNames, subfieldMap);
      var conflicts = findConflicts(subfieldMap);
      if (conflicts.length > 0) {
        return [[responseName, conflicts.map(function (_ref3) {
          var _ref4 = _slicedToArray(_ref3, 1);

          var reason = _ref4[0];
          return reason;
        })], conflicts.reduce(function (allFields, _ref5) {
          var _ref6 = _slicedToArray(_ref5, 2);

          var fields1 = _ref6[1];
          return allFields.concat(fields1);
        }, [ast1]), conflicts.reduce(function (allFields, _ref7) {
          var _ref8 = _slicedToArray(_ref7, 3);

          var fields2 = _ref8[2];
          return allFields.concat(fields2);
        }, [ast2])];
      }
    }
  }

  return {
    SelectionSet: {
      // Note: we validate on the reverse traversal so deeper conflicts will be
      // caught first, for clearer error messages.

      leave: function leave(selectionSet) {
        var fieldMap = collectFieldASTsAndDefs(context, context.getParentType(), selectionSet);
        var conflicts = findConflicts(fieldMap);
        conflicts.forEach(function (_ref9) {
          var _ref10 = _slicedToArray(_ref9, 3);

          var _ref10$ = _slicedToArray(_ref10[0], 2);

          var responseName = _ref10$[0];
          var reason = _ref10$[1];
          var fields1 = _ref10[1];
          var fields2 = _ref10[2];
          return context.reportError(new _error.GraphQLError(fieldsConflictMessage(responseName, reason), fields1.concat(fields2)));
        });
      }
    }
  };
}
// Field name and reason.

// Reason is a string, or a nested list of conflicts.

// Tuple defining an AST in a context

// Map of array of those.

function sameArguments(arguments1, arguments2) {
  if (arguments1.length !== arguments2.length) {
    return false;
  }
  return arguments1.every(function (argument1) {
    var argument2 = (0, _find2.default)(arguments2, function (argument) {
      return argument.name.value === argument1.name.value;
    });
    if (!argument2) {
      return false;
    }
    return sameValue(argument1.value, argument2.value);
  });
}

function sameValue(value1, value2) {
  return !value1 && !value2 || (0, _printer.print)(value1) === (0, _printer.print)(value2);
}

/**
 * Given a selectionSet, adds all of the fields in that selection to
 * the passed in map of fields, and returns it at the end.
 *
 * Note: This is not the same as execution's collectFields because at static
 * time we do not know what object type will be used, so we unconditionally
 * spread in all fragments.
 */
function collectFieldASTsAndDefs(context, parentType, selectionSet, visitedFragmentNames, astAndDefs) {
  var _visitedFragmentNames = visitedFragmentNames || {};
  var _astAndDefs = astAndDefs || {};
  for (var i = 0; i < selectionSet.selections.length; i++) {
    var selection = selectionSet.selections[i];
    switch (selection.kind) {
      case _kinds.FIELD:
        var fieldName = selection.name.value;
        var fieldDef = undefined;
        if (parentType instanceof _definition.GraphQLObjectType || parentType instanceof _definition.GraphQLInterfaceType) {
          fieldDef = parentType.getFields()[fieldName];
        }
        var responseName = selection.alias ? selection.alias.value : fieldName;
        if (!_astAndDefs[responseName]) {
          _astAndDefs[responseName] = [];
        }
        _astAndDefs[responseName].push([parentType, selection, fieldDef]);
        break;
      case _kinds.INLINE_FRAGMENT:
        var typeCondition = selection.typeCondition;
        var inlineFragmentType = typeCondition ? (0, _typeFromAST.typeFromAST)(context.getSchema(), selection.typeCondition) : parentType;
        _astAndDefs = collectFieldASTsAndDefs(context, inlineFragmentType, selection.selectionSet, _visitedFragmentNames, _astAndDefs);
        break;
      case _kinds.FRAGMENT_SPREAD:
        var fragName = selection.name.value;
        if (_visitedFragmentNames[fragName]) {
          continue;
        }
        _visitedFragmentNames[fragName] = true;
        var fragment = context.getFragment(fragName);
        if (!fragment) {
          continue;
        }
        var fragmentType = (0, _typeFromAST.typeFromAST)(context.getSchema(), fragment.typeCondition);
        _astAndDefs = collectFieldASTsAndDefs(context, fragmentType, fragment.selectionSet, _visitedFragmentNames, _astAndDefs);
        break;
    }
  }
  return _astAndDefs;
}

/**
 * A way to keep track of pairs of things when the ordering of the pair does
 * not matter. We do this by maintaining a sort of double adjacency sets.
 */

var PairSet = (function () {
  function PairSet() {
    _classCallCheck(this, PairSet);

    this._data = new Map();
  }

  _createClass(PairSet, [{
    key: 'has',
    value: function has(a, b) {
      var first = this._data.get(a);
      return first && first.has(b);
    }
  }, {
    key: 'add',
    value: function add(a, b) {
      _pairSetAdd(this._data, a, b);
      _pairSetAdd(this._data, b, a);
    }
  }]);

  return PairSet;
})();

function _pairSetAdd(data, a, b) {
  var set = data.get(a);
  if (!set) {
    set = new Set();
    data.set(a, set);
  }
  set.add(b);
}