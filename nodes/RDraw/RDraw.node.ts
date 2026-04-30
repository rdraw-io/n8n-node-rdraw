import type {
	IExecuteFunctions,
	INodeExecutionData,
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
				displayName: 'Data Sources',
				name: 'dataSources',
				type: 'json',
				default: '={\n  "Alunos": []\n}',
				required: true,
				description:
					'Objecto JSON com os dataSources do template. Cada chave é o nome de um dataSource e o valor é um array de registos.',
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
		],
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
						url: 'https://api.rdraw.io/api/generate',
						body: { reportId, format, dataSources },
						json: true,
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
