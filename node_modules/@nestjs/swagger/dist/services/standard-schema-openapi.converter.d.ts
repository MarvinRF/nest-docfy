import type { StandardSchemaConverter } from '../interfaces/swagger-document-options.interface.js';
import { ReferenceObject, SchemaObject } from '../interfaces/open-api-spec.interface.js';
export interface ConvertedStandardSchema {
    schema: SchemaObject | ReferenceObject;
    components: Record<string, SchemaObject>;
}
export declare class StandardSchemaOpenApiConverter {
    private readonly schemaConverter?;
    constructor(schemaConverter?: StandardSchemaConverter);
    convert(schema: unknown, schemaType?: 'input' | 'output'): ConvertedStandardSchema | undefined;
    private isStandardSchema;
    private hasStandardJsonSchema;
    private normalizeCustomConvertedSchema;
    private normalizeConvertedSchema;
    private rewriteComponents;
    private getDefinitionEntries;
    private rewriteDefinitionRefs;
    private rewriteValue;
    private normalizeSchemaExamples;
    private normalizeSchemaConst;
}
