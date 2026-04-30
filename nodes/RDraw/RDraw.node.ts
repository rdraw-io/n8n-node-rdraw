import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type ReportFormat = 'pdf' | 'xlsx' | 'docx';

const FORMAT_META: Record<ReportFormat, { mimeType: string; extension: string }> = {
	pdf: { mimeType: 'application/pdf', extension: 'pdf' },
	xlsx: {
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		extension: 'xlsx',
	},
	docx: {
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		extension: 'docx',
	},
};

const API_BASE_URL = 'https://api.rdraw.io';
const DEFAULT_TIMEOUT_MS = 120000;

type SchemaNode = string | SchemaObject | SchemaArray;
type SchemaObject = { [key: string]: SchemaNode };
type SchemaArray = [SchemaObject];

type SchemaResponse = {
	reportId: string;
	reportName?: string;
	dataSources: Record<string, SchemaNode>;
};

function defaultForType(type: string): unknown {
	switch (type) {
		case 'number':
			return 0;
		case 'boolean':
			return false;
		default:
			return '';
	}
}

function buildExampleFromNode(node: SchemaNode): unknown {
	if (typeof node === 'string') {
		return defaultForType(node);
	}
	if (Array.isArray(node)) {
		return [buildExampleFromNode(node[0] ?? {})];
	}
	const result: Record<string, unknown> = {};
	for (const [field, child] of Object.entries(node)) {
		result[field] = buildExampleFromNode(child);
	}
	return result;
}

function buildExampleFromSchema(schema: SchemaResponse['dataSources']): Record<string, unknown> {
	const example: Record<string, unknown> = {};
	for (const [dsName, node] of Object.entries(schema)) {
		example[dsName] = buildExampleFromNode(node);
	}
	return example;
}

export class RDraw implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'rDraw',
		name: 'rDraw',
		icon: { light: 'file:rdraw.svg', dark: 'file:rdraw.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["format"].toUpperCase()}}',
		description: 'Generate reports (PDF, XLSX, DOCX) from rDraw templates',
		defaults: {
			name: 'rDraw',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'rDrawApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Report ID',
				name: 'reportId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'edc6fe12-49f5-458b-aa23-d6954e005266',
				description: 'ID of the rDraw report template',
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'DOCX', value: 'docx' },
					{ name: 'PDF', value: 'pdf' },
					{ name: 'XLSX', value: 'xlsx' },
				],
				default: 'pdf',
				description: 'Output format of the report',
			},
			{
				displayName: 'Data Sources Name or ID',
				name: 'dataSources',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'loadReportSchema',
					loadOptionsDependsOn: ['reportId'],
				},
				default: '',
				required: true,
				description:
					'Loads the data sources schema from the report. Select the option to fill in the JSON template, then switch to Expression mode (fx) to edit values. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to write the generated file to',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'report',
				description:
					'File name without extension. Defaults to "report". The extension is appended based on the selected format.',
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1000 },
						default: DEFAULT_TIMEOUT_MS,
						description:
							'Maximum time to wait for the rDraw API response, in milliseconds. Default: 120000 (2 minutes).',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async loadReportSchema(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const reportId = (this.getCurrentNodeParameter('reportId') as string)?.trim();
				if (!reportId) {
					return [
						{
							name: '⚠️ Set Report ID first',
							value: '',
							description: 'Fill in the Report ID field above before loading the schema',
						},
					];
				}

				try {
					const schema = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'rDrawApi',
						{
							method: 'GET',
							url: `${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}/schema`,
							json: true,
							timeout: 30000,
						},
					)) as SchemaResponse;

					if (!schema?.dataSources) {
						return [
							{
								name: '❌ Invalid API response',
								value: '',
								description: 'The endpoint did not return dataSources',
							},
						];
					}

					const example = buildExampleFromSchema(schema.dataSources);
					const jsonText = JSON.stringify(example, null, 2);
					const reportName = schema.reportName ?? reportId;

					return [
						{
							name: `📥 Load schema for "${reportName}"`,
							value: jsonText,
							description:
								'Selecting this fills the field with the schema JSON. Switch to Expression mode (fx) to edit values.',
						},
					];
				} catch (error) {
					return [
						{
							name: `❌ Failed to load schema: ${(error as Error).message}`,
							value: '',
							description: 'Check the credential and the Report ID',
						},
					];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const reportId = this.getNodeParameter('reportId', i) as string;
				const format = this.getNodeParameter('format', i) as ReportFormat;
				const dataSourcesRaw = this.getNodeParameter('dataSources', i);
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const fileNameInput = (this.getNodeParameter('fileName', i, '') as string).trim();
				const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as {
					timeout?: number;
				};
				const timeout = additionalOptions.timeout ?? DEFAULT_TIMEOUT_MS;

				let dataSources: unknown;
				if (typeof dataSourcesRaw === 'string') {
					try {
						dataSources = JSON.parse(dataSourcesRaw);
					} catch (err) {
						throw new NodeOperationError(
							this.getNode(),
							`The "Data Sources" field is not valid JSON: ${(err as Error).message}`,
							{ itemIndex: i },
						);
					}
				} else {
					dataSources = dataSourcesRaw;
				}

				const responseData = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'rDrawApi',
					{
						method: 'POST',
						url: `${API_BASE_URL}/api/generate`,
						body: { reportId, format, dataSources },
						json: true,
						timeout,
					},
				)) as { data?: string; success?: boolean };

				if (!responseData?.data) {
					throw new NodeOperationError(
						this.getNode(),
						'The rDraw API response does not contain a "data" field with the report content.',
						{ itemIndex: i },
					);
				}

				const { mimeType, extension } = FORMAT_META[format];
				const baseName = fileNameInput.length > 0 ? fileNameInput : 'report';
				const fileName = `${baseName}.${extension}`;

				const binaryData = await this.helpers.prepareBinaryData(
					Buffer.from(responseData.data, 'base64'),
					fileName,
					mimeType,
				);

				returnData.push({
					json: { success: true, reportId, format, fileName },
					binary: { [binaryPropertyName]: binaryData },
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if ((error as { context?: { itemIndex: number } }).context) {
					(error as { context: { itemIndex: number } }).context.itemIndex = i;
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
