import { App, Plugin, PluginSettingTab, Setting, normalizePath, Notice, requestUrl } from 'obsidian';

// Remember to rename these classes and interfaces!

interface LimitlessLifelogsSettings {
	apiKey: string;
	folderPath: string;
	startDate: string;
}

const DEFAULT_SETTINGS: LimitlessLifelogsSettings = {
	apiKey: '',
	folderPath: 'Limitless Lifelogs',
	startDate: '2025-02-09'
}

export default class LimitlessLifelogsPlugin extends Plugin {
	settings: LimitlessLifelogsSettings;
	api: LimitlessAPI;

	async onload() {
		await this.loadSettings();
		this.api = new LimitlessAPI(this.settings.apiKey);

		// Add settings tab
		this.addSettingTab(new LimitlessLifelogsSettingTab(this.app, this));

		// Add ribbon icon for syncing
		this.addRibbonIcon('sync', 'Sync Limitless Lifelogs', async () => {
			await this.syncLifelogs();
		});

		// Add command for syncing
		this.addCommand({
			id: 'sync-limitless-lifelogs',
			name: 'Sync',
			callback: async () => {
				await this.syncLifelogs();
			}
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.api) {
			this.api.setApiKey(this.settings.apiKey);
		}
	}

	async syncLifelogs() {
		if (!this.settings.apiKey) {
			new Notice('Please set your Limitless API key in settings');
			return;
		}

		try {
			// Ensure the folder exists
			const folderPath = normalizePath(this.settings.folderPath);
			await this.ensureFolderExists(folderPath);

			// Get the last synced date
			const lastSyncedDate = await this.getLastSyncedDate();
			const startDate = lastSyncedDate || new Date(this.settings.startDate);
			const endDate = new Date();

			new Notice('Starting Limitless lifelog sync...');

			const currentDate = new Date(startDate);
			while (currentDate <= endDate) {
				const dateStr = currentDate.toISOString().split('T')[0];
				const logs = await this.api.getLifelogs(currentDate);

				if (logs && logs.length > 0) {
					const content = logs.map(log => this.formatLifelogMarkdown(log)).join('\n\n');
					const filePath = `${folderPath}/${dateStr}.md`;
					await this.app.vault.adapter.write(filePath, content);
					new Notice(`Synced entries for ${dateStr}`);
				}

				currentDate.setDate(currentDate.getDate() + 1);
			}

			new Notice('Limitless lifelog sync complete!');
		} catch (error) {
			console.error('Error syncing lifelogs:', error);
			new Notice('Error syncing Limitless lifelogs. Check console for details.');
		}
	}

	private async ensureFolderExists(path: string) {
		const folder = this.app.vault.getFolderByPath(path);
		if (!folder) {
			await this.app.vault.createFolder(path);
		}
	}

	private async getLastSyncedDate(): Promise<Date | null> {
		const folderPath = normalizePath(this.settings.folderPath);
		try {
			const files = this.app.vault.getFiles()
				.filter(file => file.path.startsWith(folderPath + '/'))
				.filter(file => file.path.endsWith('.md'))
				.map(file => file.basename)
				.filter(basename => /^\d{4}-\d{2}-\d{2}$/.test(basename))
				.map(basename => new Date(basename))
				.sort((a, b) => b.getTime() - a.getTime());

			return files.length > 0 ? files[0] : null;
		} catch {
			return null;
		}
	}

	private formatLifelogMarkdown(lifelog: any): string {
		if (lifelog.markdown) {
			// Reformat Markdown
			const reformattedMarkdown = lifelog.markdown.replaceAll('\n\n', '\n');
			return reformattedMarkdown;
		}

		const content: string[] = [];

		if (lifelog.title) {
			content.push(`# ${lifelog.title}\n`);
		}

		if (lifelog.contents) {
			let currentSection = '';
			let sectionMessages: string[] = [];

			for (const node of lifelog.contents) {
				if (node.type === 'heading2') {
					if (currentSection && sectionMessages.length > 0) {
						content.push(`## ${currentSection}\n`);
						content.push(...sectionMessages);
						content.push('');
					}
					currentSection = node.content;
					sectionMessages = [];
				} else if (node.type === 'blockquote') {
					const speaker = node.speakerName || 'Speaker';
					let timestamp = '';
					if (node.startTime) {
						const dt = new Date(node.startTime);
						timestamp = dt.toLocaleString('en-US', {
							month: '2-digit',
							day: '2-digit',
							year: '2-digit',
							hour: 'numeric',
							minute: '2-digit',
							hour12: true
						});
						timestamp = `(${timestamp})`;
					}

					const message = `- ${speaker} ${timestamp}: ${node.content}`;
					if (currentSection) {
						sectionMessages.push(message);
					} else {
						content.push(message);
					}
				} else if (node.type !== 'heading1') {
					content.push(node.content);
				}
			}

			if (currentSection && sectionMessages.length > 0) {
				content.push(`## ${currentSection}\n`);
				content.push(...sectionMessages);
			}
		}

		return content.join('\n\n');
	}
}

class LimitlessLifelogsSettingTab extends PluginSettingTab {
	plugin: LimitlessLifelogsPlugin;

	constructor(app: App, plugin: LimitlessLifelogsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your Limitless AI API key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Folder path')
			.setDesc('Where to store the lifelog entries')
			.addText(text => text
				.setPlaceholder('Folder path')
				.setValue(this.plugin.settings.folderPath)
				.onChange(async (value) => {
					this.plugin.settings.folderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Start date')
			.setDesc('Default start date for initial sync (YYYY-MM-DD)')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.startDate)
				.onChange(async (value) => {
					this.plugin.settings.startDate = value;
					await this.plugin.saveSettings();
				}));
	}
}

class LimitlessAPI {
	private apiKey: string;
	private baseUrl = 'https://api.limitless.ai';
	private batchSize = 10;
	private maxRetries = 5;
	private retryDelay = 1000; // 1 second

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	setApiKey(apiKey: string) {
		this.apiKey = apiKey;
	}

	async getLifelogs(date: Date): Promise<any[]> {
		const allLifelogs: any[] = [];
		let cursor: string | null = null;

		const params = new URLSearchParams({
			date: date.toISOString().split('T')[0],
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			includeMarkdown: 'true',
			includeHeadings: 'true',
			direction: 'asc',
			limit: this.batchSize.toString()
		});

		do {
			if (cursor) {
				params.set('cursor', cursor);
			}

			try {
				const data = await this.makeRequest(`${this.baseUrl}/v1/lifelogs`, params);
				const lifelogs = data.data?.lifelogs || [];
				allLifelogs.push(...lifelogs);

				cursor = data.meta?.lifelogs?.nextCursor || null;
			} catch (error) {
				console.error('Error fetching lifelogs:', error);
				throw error;
			}
		} while (cursor);

		return allLifelogs;
	}

	private async makeRequest(url: string, params: URLSearchParams): Promise<any> {
		let retries = 0;
		while (true) {
			try {
				const response = await requestUrl({
					url: `${url}?${params.toString()}`,
					method: 'GET',
					headers: {
						'X-API-Key': this.apiKey,
						'Content-Type': 'application/json'
					}
				});

				if (!response.json) {
					throw new Error('Invalid response format');
				}

				return response.json;
			} catch (error) {
				if (error.status === 429 && retries < this.maxRetries) {
					let delay = this.retryDelay * Math.pow(2, retries);
					const retryAfter = error.headers?.['retry-after'];

					if (retryAfter) {
						const retryAfterSeconds = parseInt(retryAfter, 10);
						if (!isNaN(retryAfterSeconds)) {
							delay = retryAfterSeconds * 1000;
						} else {
							const retryAfterDate = new Date(retryAfter);
							const now = new Date();
							delay = retryAfterDate.getTime() - now.getTime();
						}
					}

					new Notice(`Rate limit exceeded. Retrying in ${Math.round(delay / 1000)} seconds...`);
					await new Promise(resolve => setTimeout(resolve, delay));
					retries++;
				} else {
					console.error('Error making request:', error);
					throw error;
				}
			}
		}
	}
}
