import { omit, omitBy, transform } from 'es-toolkit/compat';
export class StandardSchemaOpenApiConverter {
    constructor(schemaConverter) {
        this.schemaConverter = schemaConverter;
    }
    convert(schema, schemaType = 'input') {
        if (!this.isStandardSchema(schema)) {
            return undefined;
        }
        const customSchema = this.schemaConverter?.(schema, { schemaType });
        if (customSchema) {
            return this.normalizeCustomConvertedSchema(customSchema);
        }
        if (!this.hasStandardJsonSchema(schema)) {
            return undefined;
        }
        const convert = schema['~standard'].jsonSchema?.[schemaType];
        if (!convert) {
            return undefined;
        }
        const convertedSchema = convert({ target: 'openapi-3.0' });
        if (!convertedSchema || typeof convertedSchema !== 'object') {
            return undefined;
        }
        return this.normalizeConvertedSchema(convertedSchema);
    }
    isStandardSchema(schema) {
        return !!(schema && typeof schema === 'object' && '~standard' in schema);
    }
    hasStandardJsonSchema(schema) {
        const standard = schema['~standard'];
        return !!standard && 'jsonSchema' in standard;
    }
    normalizeCustomConvertedSchema(convertedSchema) {
        return {
            schema: this.rewriteDefinitionRefs(convertedSchema.schema),
            components: this.rewriteComponents(convertedSchema.components || {})
        };
    }
    normalizeConvertedSchema(schema, components = {}) {
        const normalizedComponents = this.getDefinitionEntries(schema).reduce((acc, [name, definition]) => ({
            ...acc,
            [name]: this.rewriteDefinitionRefs(definition)
        }), {});
        return {
            schema: this.rewriteDefinitionRefs(omit(schema, ['$defs', 'definitions', '$schema'])),
            components: {
                ...this.rewriteComponents(components),
                ...normalizedComponents
            }
        };
    }
    rewriteComponents(components) {
        return Object.entries(components).reduce((acc, [name, definition]) => ({
            ...acc,
            [name]: this.rewriteDefinitionRefs(definition)
        }), {});
    }
    getDefinitionEntries(schema) {
        const definitions = schema.$defs || schema.definitions;
        if (!definitions || typeof definitions !== 'object') {
            return [];
        }
        return Object.entries(definitions);
    }
    rewriteDefinitionRefs(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this.rewriteValue(item));
        }
        const rewrittenValue = omitBy(transform(value, (result, currentValue, key) => {
            result[key] = this.rewriteValue(currentValue);
        }, {}), (currentValue) => currentValue === undefined);
        return this.normalizeSchemaExamples(rewrittenValue);
    }
    rewriteValue(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this.rewriteValue(item));
        }
        if (!value || typeof value !== 'object') {
            return value;
        }
        const currentValue = value;
        if (typeof currentValue.$ref === 'string') {
            return {
                ...this.rewriteDefinitionRefs(omit(currentValue, ['$ref'])),
                $ref: currentValue.$ref
                    .replace('#/$defs/', '#/components/schemas/')
                    .replace('#/definitions/', '#/components/schemas/')
            };
        }
        return this.rewriteDefinitionRefs(currentValue);
    }
    normalizeSchemaExamples(value) {
        const normalizedConstValue = this.normalizeSchemaConst(value);
        if (!Array.isArray(normalizedConstValue.examples) ||
            normalizedConstValue.example !== undefined) {
            return normalizedConstValue;
        }
        const [firstExample] = normalizedConstValue.examples;
        return {
            ...omit(normalizedConstValue, ['examples']),
            example: firstExample
        };
    }
    normalizeSchemaConst(value) {
        if (!('const' in value)) {
            return value;
        }
        const constValue = value.const;
        if (!Array.isArray(value.examples) || value.example !== undefined) {
            return {
                ...omit(value, ['const']),
                enum: value.enum ?? [constValue]
            };
        }
        return {
            ...omit(value, ['const']),
            enum: value.enum ?? [constValue]
        };
    }
}
