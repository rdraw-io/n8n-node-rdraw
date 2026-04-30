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

function describeNode(node: SchemaNode): string {
	if (Array.isArray(node)) {
		const inner = node[0] ?? {};
		const count = typeof inner === 'object' && inner !== null ? Object.keys(inner).length : 0;
		return `array de ${count} campo${count === 1 ? '' : 's'}`;
	}
	if (typeof node === 'object' && node !== null) {
		const count = Object.keys(node).length;
		return `objeto com ${count} campo${count === 1 ? '' : 's'}`;
	}
	return 'valor';
}

function topLevelKeysMatch(current: unknown, schema: Record<string, unknown>): boolean {
	if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
	const currentKeys = Object.keys(current as Record<string, unknown>).sort();
	const schemaKeys = Object.keys(schema).sort();
	if (currentKeys.length !== schemaKeys.length) return false;
	return currentKeys.every((k, i) => k === schemaKeys[i]);
}

export class RDraw implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'rDraw',
		name: 'rDraw',
		icon: { light: 'file:rdraw.svg', dark: 'file:rdraw.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["format"].toUpperCase()}}',
		description: 'Gera relatórios (PDF, XLSX, DOCX) a partir de templates rDraw',
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
				description: 'ID do template do relatório no rDraw',
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
				description: 'Formato de saída do relatório',
			},
			{
				displayName:
					'💡 Dica: depois de definires a credencial e o Report ID, clica em "Carregar Schema" abaixo para preencher automaticamente o template dos Data Sources com base no relatório.',
				name: 'schemaNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Carregar Schema Do Relatório Name or ID',
				name: 'loadSchema',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'loadReportSchema',
					loadOptionsDependsOn: ['reportId'],
				},
				default: '',
				description:
					'Carrega o schema do relatório a partir do rDraw. Selecciona a opção apresentada e copia o JSON exibido para o campo "Data Sources" abaixo. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Data Sources',
				name: 'dataSources',
				type: 'json',
				default: '={\n  "Alunos": []\n}',
				required: true,
				description:
					'Objecto JSON com os dataSources do template. Cada chave é o nome de um dataSource e o valor é um array de registos. Usa "Carregar Schema" acima para gerar o template.',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Nome da propriedade binária onde o ficheiro gerado será colocado',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'report',
				description:
					'Nome do ficheiro (sem extensão). Se vazio, usa "report". A extensão é adicionada conforme o formato.',
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Adicionar opção',
				default: {},
				options: [
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1000 },
						default: DEFAULT_TIMEOUT_MS,
						description:
							'Tempo máximo de espera pela resposta da API rDraw, em milissegundos. Default: 120000 (2 minutos).',
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
							name: '⚠️ Define Primeiro O Report ID Acima',
							value: '',
							description: 'Preenche o campo Report ID antes de carregar o schema',
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
								name: '❌ Resposta Inválida Da API',
								value: '',
								description: 'O endpoint não retornou dataSources',
							},
						];
					}

					const example = buildExampleFromSchema(schema.dataSources);
					const jsonText = JSON.stringify(example, null, 2);
					const reportName = schema.reportName ?? reportId;

					const currentRaw = this.getCurrentNodeParameter('dataSources');
					let currentParsed: unknown = currentRaw;
					if (typeof currentRaw === 'string') {
						try {
							currentParsed = JSON.parse(currentRaw);
						} catch {
							currentParsed = undefined;
						}
					}
					const matches = topLevelKeysMatch(
						currentParsed,
						example as Record<string, unknown>,
					);
					const headerName = matches
						? `✅ ${reportName} — schema já está actualizado`
						: `📥 ${reportName} — copia o JSON para Data Sources`;
					const headerDescription = matches
						? 'As chaves do Data Sources actual coincidem com o schema do template.'
						: 'Selecciona esta opção e copia o JSON apresentado para o campo Data Sources.';

					const dsOptions: INodePropertyOptions[] = Object.entries(schema.dataSources).map(
						([name, node]) => ({
							name: `📋 ${name} — ${describeNode(node)}`,
							value: '',
							description: JSON.stringify(buildExampleFromNode(node), null, 2),
						}),
					);

					return [
						{
							name: headerName,
							value: jsonText,
							description: headerDescription + '\n\n' + jsonText,
						},
						...dsOptions,
					];
				} catch (error) {
					return [
						{
							name: `❌ Erro ao carregar schema: ${(error as Error).message}`,
							value: '',
							description: 'Verifica a credencial e o Report ID',
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
							`O campo "Data Sources" não é um JSON válido: ${(err as Error).message}`,
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
						'A resposta da API rDraw não contém o campo "data" com o conteúdo do relatório.',
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
