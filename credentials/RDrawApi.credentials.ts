import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RDrawApi implements ICredentialType {
	name = 'rDrawApi';
	displayName = 'rDraw API';
	documentationUrl = 'https://rdraw.io/docs';
	icon = 'file:rdraw.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.rdraw.io',
			url: '/api/health',
			method: 'GET',
		},
	};
}
