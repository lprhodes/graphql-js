'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildASTSchema = buildASTSchema;

var _invariant = require('../jsutils/invariant');

var _invariant2 = _interopRequireDefault(_invariant);

var _keyMap = require('../jsutils/keyMap');

var _keyMap2 = _interopRequireDefault(_keyMap);

var _keyValMap = require('../jsutils/keyValMap');

var _keyValMap2 = _interopRequireDefault(_keyValMap);

var _valueFromAST = require('./valueFromAST');

var _kinds = require('../language/kinds');

var _ast = require('../language/ast');

var _type = require('../type');

var _definition = require('../type/definition');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function buildWrappedType(innerType, inputTypeAST) {
  if (inputTypeAST.kind === _kinds.LIST_TYPE) {
    return new _type.GraphQLList(buildWrappedType(innerType, inputTypeAST.type));
  }
  if (inputTypeAST.kind === _kinds.NON_NULL_TYPE) {
    var wrappedType = buildWrappedType(innerType, inputTypeAST.type);
    (0, _invariant2.default)(!(wrappedType instanceof _type.GraphQLNonNull), 'No nesting nonnull.');
    return new _type.GraphQLNonNull(wrappedType);
  }
  return innerType;
}
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

function getNamedTypeAST(typeAST) {
  var namedType = typeAST;
  while (namedType.kind === _kinds.LIST_TYPE || namedType.kind === _kinds.NON_NULL_TYPE) {
    namedType = namedType.type;
  }
  return namedType;
}

/**
 * This takes the ast of a schema document produced by parseSchema in
 * src/language/schema/parser.js.
 *
 * Given that AST it constructs a GraphQLSchema. As constructed
 * they are not particularly useful for non-introspection queries
 * since they have no resolve methods.
 */
function buildASTSchema(ast, queryTypeName, mutationTypeName, subscriptionTypeName) {
  if (!ast) {
    throw new Error('must pass in ast');
  }

  if (!queryTypeName) {
    throw new Error('must pass in query type');
  }

  var typeDefs = [];
  for (var i = 0; i < ast.definitions.length; i++) {
    var d = ast.definitions[i];
    switch (d.kind) {
      case _kinds.OBJECT_TYPE_DEFINITION:
      case _kinds.INTERFACE_TYPE_DEFINITION:
      case _kinds.ENUM_TYPE_DEFINITION:
      case _kinds.UNION_TYPE_DEFINITION:
      case _kinds.SCALAR_TYPE_DEFINITION:
      case _kinds.INPUT_OBJECT_TYPE_DEFINITION:
        typeDefs.push(d);
    }
  }

  var astMap = (0, _keyMap2.default)(typeDefs, function (d) {
    return d.name.value;
  });

  if (!astMap[queryTypeName]) {
    throw new Error('Specified query type ' + queryTypeName + ' not found in document.');
  }

  if (mutationTypeName && !astMap[mutationTypeName]) {
    throw new Error('Specified mutation type ' + mutationTypeName + ' not found in document.');
  }

  if (subscriptionTypeName && !astMap[subscriptionTypeName]) {
    throw new Error('Specified subscription type ' + subscriptionTypeName + ' not found in document.');
  }

  var innerTypeMap = {
    String: _type.GraphQLString,
    Int: _type.GraphQLInt,
    Float: _type.GraphQLFloat,
    Boolean: _type.GraphQLBoolean,
    ID: _type.GraphQLID
  };

  typeDefs.forEach(function (def) {
    return typeDefNamed(def.name.value);
  });

  return new _type.GraphQLSchema({
    query: getObjectType(astMap[queryTypeName]),
    mutation: mutationTypeName ? getObjectType(astMap[mutationTypeName]) : null,
    subscription: subscriptionTypeName ? getObjectType(astMap[subscriptionTypeName]) : null
  });

  function getObjectType(typeAST) {
    var type = typeDefNamed(typeAST.name.value);
    (0, _invariant2.default)(type instanceof _type.GraphQLObjectType, 'AST must provide object type.');
    return type;
  }

  function produceTypeDef(typeAST) {
    var typeName = getNamedTypeAST(typeAST).name.value;
    var typeDef = typeDefNamed(typeName);
    return buildWrappedType(typeDef, typeAST);
  }

  function typeDefNamed(typeName) {
    if (innerTypeMap[typeName]) {
      return innerTypeMap[typeName];
    }

    if (!astMap[typeName]) {
      throw new Error('Type ' + typeName + ' not found in document');
    }

    var innerTypeDef = makeSchemaDef(astMap[typeName]);
    if (!innerTypeDef) {
      throw new Error('Nothing constructed for ' + typeName);
    }
    innerTypeMap[typeName] = innerTypeDef;
    return innerTypeDef;
  }

  function makeSchemaDef(def) {
    if (!def) {
      throw new Error('def must be defined');
    }
    switch (def.kind) {
      case _kinds.OBJECT_TYPE_DEFINITION:
        return makeTypeDef(def);
      case _kinds.INTERFACE_TYPE_DEFINITION:
        return makeInterfaceDef(def);
      case _kinds.ENUM_TYPE_DEFINITION:
        return makeEnumDef(def);
      case _kinds.UNION_TYPE_DEFINITION:
        return makeUnionDef(def);
      case _kinds.SCALAR_TYPE_DEFINITION:
        return makeScalarDef(def);
      case _kinds.INPUT_OBJECT_TYPE_DEFINITION:
        return makeInputObjectDef(def);
      default:
        throw new Error(def.kind + ' not supported');
    }
  }

  function makeTypeDef(def) {
    var typeName = def.name.value;
    var config = {
      name: typeName,
      fields: function fields() {
        return makeFieldDefMap(def);
      },
      interfaces: function interfaces() {
        return makeImplementedInterfaces(def);
      }
    };
    return new _type.GraphQLObjectType(config);
  }

  function makeFieldDefMap(def) {
    return (0, _keyValMap2.default)(def.fields, function (field) {
      return field.name.value;
    }, function (field) {
      return {
        type: produceTypeDef(field.type),
        args: makeInputValues(field.arguments)
      };
    });
  }

  function makeImplementedInterfaces(def) {
    return def.interfaces.map(function (inter) {
      return produceTypeDef(inter);
    });
  }

  function makeInputValues(values) {
    return (0, _keyValMap2.default)(values, function (value) {
      return value.name.value;
    }, function (value) {
      var type = produceTypeDef(value.type);
      return { type: type, defaultValue: (0, _valueFromAST.valueFromAST)(value.defaultValue, type) };
    });
  }

  function makeInterfaceDef(def) {
    var typeName = def.name.value;
    var config = {
      name: typeName,
      resolveType: function resolveType() {
        return null;
      },
      fields: function fields() {
        return makeFieldDefMap(def);
      }
    };
    return new _type.GraphQLInterfaceType(config);
  }

  function makeEnumDef(def) {
    var enumType = new _type.GraphQLEnumType({
      name: def.name.value,
      values: (0, _keyValMap2.default)(def.values, function (v) {
        return v.name.value;
      }, function () {
        return {};
      })
    });

    return enumType;
  }

  function makeUnionDef(def) {
    return new _type.GraphQLUnionType({
      name: def.name.value,
      resolveType: function resolveType() {
        return null;
      },
      types: def.types.map(function (t) {
        return produceTypeDef(t);
      })
    });
  }

  function makeScalarDef(def) {
    return new _type.GraphQLScalarType({
      name: def.name.value,
      serialize: function serialize() {
        return null;
      },
      // Note: validation calls the parse functions to determine if a
      // literal value is correct. Returning null would cause use of custom
      // scalars to always fail validation. Returning false causes them to
      // always pass validation.
      parseValue: function parseValue() {
        return false;
      },
      parseLiteral: function parseLiteral() {
        return false;
      }
    });
  }

  function makeInputObjectDef(def) {
    return new _type.GraphQLInputObjectType({
      name: def.name.value,
      fields: function fields() {
        return makeInputValues(def.fields);
      }
    });
  }
}