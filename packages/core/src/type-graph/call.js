// @flow
import NODE from "../utils/nodes";
import { Type } from "./types/type";
import { Scope } from "./scope";
import { CallMeta } from "./meta/call-meta";
import { ObjectType } from "./types/object-type";
import { ModuleScope } from "./module-scope";
import { addPosition } from "../utils/position-utils";
import { GenericType } from "./types/generic-type";
import { FunctionType } from "./types/function-type";
import { VariableInfo } from "./variable-info";
import { addToThrowable } from "../utils/throwable";
import { getInvocationType } from "../inference/function-type";
import { inferenceTypeForNode } from "../inference";
import { getAnonymousKey, findVariableInfo } from "../utils/common";
import {
  findNearestTypeScope,
  findNearestScopeByType
} from "../utils/scope-utils";
import type { Node } from "@babel/parser";
import type { CallableArguments } from "./meta/call-meta";

export function addCallToTypeGraph(
  node: Node,
  typeGraph: ModuleScope,
  currentScope: Scope | ModuleScope
): CallableArguments {
  let target: ?VariableInfo = null;
  let targetName: string = "";
  let args: ?Array<CallableArguments> = null;
  let genericArguments: ?Array<CallableArguments> = null;
  const typeScope = findNearestTypeScope(currentScope, typeGraph);
  if (!(typeScope instanceof Scope)) {
    throw new Error("Never!");
  }
  switch (node.type) {
    case NODE.IF_STATEMENT:
      target = findVariableInfo({ name: "if", loc: node.loc }, currentScope);
      args = [addCallToTypeGraph(node.test, typeGraph, currentScope)];
      break;
    case NODE.WHILE_STATEMENT:
      target = findVariableInfo({ name: "while", loc: node.loc }, currentScope);
      args = [addCallToTypeGraph(node.test, typeGraph, currentScope)];
      break;
    case NODE.DO_WHILE_STATEMENT:
      target = findVariableInfo(
        { name: "do-while", loc: node.loc },
        currentScope
      );
      args = [addCallToTypeGraph(node.test, typeGraph, currentScope)];
      break;
    case NODE.FOR_STATEMENT:
      target = findVariableInfo({ name: "for", loc: node.loc }, currentScope);
      args = [
        Type.createTypeWithName("mixed", typeScope),
        node.test
          ? addCallToTypeGraph(
              node.test,
              typeGraph,
              // $FlowIssue
              typeGraph.body.get(Scope.getName(node.body))
            )
          : Type.createTypeWithName("undefined", typeScope),
        Type.createTypeWithName("mixed", typeScope)
      ];
      break;
    case NODE.FUNCTION_EXPRESSION:
    case NODE.ARROW_FUNCTION_EXPRESSION:
    case NODE.CLASS_DECLARATION:
    case NODE.IDENTIFIER:
      const nodeName =
        node.type === NODE.IDENTIFIER
          ? node
          : { name: getAnonymousKey(node), loc: node.loc };
      const varInfo = findVariableInfo(nodeName, currentScope);
      if (node.type === NODE.IDENTIFIER) {
        addPosition(node, varInfo, typeGraph);
      }
      return varInfo;
    case NODE.VARIABLE_DECLARATOR:
      const variableType = findVariableInfo(node.id, currentScope);
      addPosition(node.id, variableType, typeGraph);
      if (!node.init) {
        return variableType;
      }
      args = [
        variableType,
        addCallToTypeGraph(node.init, typeGraph, currentScope)
      ];
      targetName = "=";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.EXPRESSION_STATEMENT:
      return addCallToTypeGraph(node.expression, typeGraph, currentScope);
    case NODE.THROW_STATEMENT:
      args = [addCallToTypeGraph(node.argument, typeGraph, currentScope)];
      targetName = "throw";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      addToThrowable(args[0], currentScope);
      break;
    case NODE.RETURN_STATEMENT:
    case NODE.UNARY_EXPRESSION:
    case NODE.UPDATE_EXPRESSION:
      args = [addCallToTypeGraph(node.argument, typeGraph, currentScope)];
      targetName = node.operator || "return";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.BINARY_EXPRESSION:
    case NODE.LOGICAL_EXPRESSION:
      args = [
        addCallToTypeGraph(node.left, typeGraph, currentScope),
        addCallToTypeGraph(node.right, typeGraph, currentScope)
      ];
      targetName = node.operator;
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.ASSIGNMENT_EXPRESSION:
      args = [
        addCallToTypeGraph(node.left, typeGraph, currentScope),
        addCallToTypeGraph(node.right, typeGraph, currentScope)
      ];
      targetName = node.operator;
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.MEMBER_EXPRESSION:
      args = [
        addCallToTypeGraph(node.object, typeGraph, currentScope),
        node.property.type === NODE.IDENTIFIER && !node.computed
          ? Type.createTypeWithName(node.property.name, typeScope, {
              isLiteralOf: Type.createTypeWithName("string", typeScope)
            })
          : addCallToTypeGraph(node.property, typeGraph, currentScope)
      ];
      genericArguments = args;
      targetName = ".";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.CONDITIONAL_EXPRESSION:
      args = [
        addCallToTypeGraph(node.test, typeGraph, currentScope),
        addCallToTypeGraph(node.consequent, typeGraph, currentScope),
        addCallToTypeGraph(node.alternate, typeGraph, currentScope)
      ];
      targetName = "?:";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    case NODE.CALL_EXPRESSION:
      args = node.arguments.map(n =>
        addCallToTypeGraph(n, typeGraph, currentScope)
      );
      if (node.callee.type === NODE.IDENTIFIER) {
        target = findVariableInfo(node.callee, currentScope);
        addPosition(node.callee, target, typeGraph);
      } else {
        target = (addCallToTypeGraph(
          node.callee,
          typeGraph,
          currentScope
        ): any);
      }
      const { throwable } = target;
      if (throwable) {
        addToThrowable(throwable, currentScope);
      }
      break;
    case NODE.NEW_EXPRESSION:
      const argument = addCallToTypeGraph(node.callee, typeGraph, currentScope);
      const argumentType =
        argument instanceof VariableInfo ? argument.type : argument;
      const potentialArgument =
        argumentType instanceof FunctionType ||
        (argumentType instanceof GenericType &&
          argumentType.subordinateType instanceof FunctionType)
          ? getInvocationType(
              argumentType,
              node.arguments.map(a =>
                addCallToTypeGraph(a, typeGraph, currentScope)
              )
            )
          : argumentType;
      args = [
        potentialArgument instanceof ObjectType
          ? potentialArgument
          : ObjectType.createTypeWithName("{ }", typeScope, [])
      ];
      targetName = "new";
      target = findVariableInfo(
        { name: targetName, loc: node.loc },
        currentScope
      );
      break;
    default:
      return inferenceTypeForNode(node, typeScope, currentScope, typeGraph);
  }
  const callsScope =
    currentScope.type === Scope.FUNCTION_TYPE
      ? currentScope
      : findNearestScopeByType(Scope.FUNCTION_TYPE, currentScope);
  if (
    target.type instanceof FunctionType ||
    (target.type instanceof GenericType &&
      target.type.subordinateType instanceof FunctionType)
  ) {
    const callMeta = new CallMeta((target: any), args, node.loc, targetName);
    const invocationType = getInvocationType(
      (target.type: any),
      args.map(a => (a instanceof Type ? a : a.type)),
      // $FlowIssue
      genericArguments &&
        genericArguments.map(a => (a instanceof Type ? a : a.type)),
      node.loc
    );
    callsScope.calls.push(callMeta);
    return invocationType;
  }
  throw new Error(target.type.constructor.name);
}
