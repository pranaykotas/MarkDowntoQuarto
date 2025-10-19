import { App, Plugin, TFile, Notice, moment } from 'obsidian';
import * as fs from 'fs'; // Node.js File System module

// @ts-ignore
import { remote } from 'electron'; // Electron 'remote' module for dialogs

export default class QuartoConverterPlugin extends Plugin {

	async onload() {
		// --- Requirement 5: Create a ribbon button ---
		this.addRibbonIcon('file-output', 'Convert to Quarto (.qmd)', () => {
			this.convertActiveFileToQmd();
		});

		// Add a command for power users (Ctrl+P)
		this.addCommand({
			id: 'convert-active-to-qmd',
			name: 'Convert active file to Quarto (.qmd)',
			callback: () => {
				this.convertActiveFileToQmd();
			}
		});
	}

	onunload() {}

	/**
	 * Main function to handle the conversion process.
	 */
	async convertActiveFileToQmd() {
		const activeFile = this.app.workspace.getActiveFile();

		// Check if a file is active
		if (!activeFile) {
			new Notice('No active file selected.');
			return;
		}

		// Check if it's a Markdown file
		if (activeFile.extension !== 'md') {
			new Notice('Please select a Markdown (.md) file.');
			return;
		}

		// 1. Read file content
		const fileContent = await this.app.vault.read(activeFile);

		// 2. Process content (Req 1 & 2)
		const { qmdContent, warnings } = this.processMarkdownForQuarto(fileContent);

		// 3. Generate new filename (Req 3)
		const newFileName = this.generateQmdFileName(activeFile.basename);

		// 4. Ask user for save location (Req 4)
		const { dialog } = remote; // Get dialog from Electron's remote module
		const result = await dialog.showSaveDialog({
			title: 'Save Quarto File',
			defaultPath: newFileName,
			filters: [
				{ name: 'Quarto Files', extensions: ['qmd'] },
				{ name: 'All Files', extensions: ['*'] }
			]
		});

		// Handle cancellation
		if (result.canceled || !result.filePath) {
			new Notice('Export canceled.');
			return;
		}

		const savePath = result.filePath;

		// 5. Write the file to the chosen path (Req 3)
		try {
			fs.writeFileSync(savePath, qmdContent);
			new Notice(`Successfully exported to ${savePath}`, 5000);

			// Show warnings if any
			if (warnings.length > 0) {
				new Notice('Conversion complete with warnings:\n- ' + warnings.join('\n- '), 10000);
			}
		} catch (err) {
			console.error('Quarto Export Error:', err);
			new Notice('Failed to save file. Check developer console (Ctrl+Shift+I) for details.');
		}
	}

	/**
	 * Generates a Quarto-compatible filename.
	 * Format: YYYYMMDD-<hyphenated-title>.qmd
	 */
	generateQmdFileName(title: string): string {
		const date = moment().format('YYYYMMDD');
		
		const slug = title
			.toLowerCase()
			.trim()
			.replace(/[\s_]+/g, '-')       // Replace spaces and underscores with -
			.replace(/[^\w-]+/g, '')     // Remove all non-word chars (except hyphen)
			.replace(/--+/g, '-')         // Replace multiple - with single -
			.replace(/^-+|-+$/g, '');      // Trim hyphens from start/end
		
		return `${date}-${slug || 'untitled'}.qmd`;
	}

	/**
	 * Processes the Markdown content for Quarto compatibility.
	 * - Retains YAML frontmatter (Req 1)
	 * - Reformats content (Req 2)
	 */
	processMarkdownForQuarto(content: string): { qmdContent: string, warnings: string[] } {
		const warnings: string[] = [];
		let yaml = '';
		let body = content;

		// --- Requirement 1: Strictly retain the YAML frontmatter ---
		const yamlRegex = /^---[\r\n]?([\s\S]*?)[\r\n]---[\r\n]/;
		const match = content.match(yamlRegex);

		if (match) {
			yaml = match[0]; // Keep the full block, including '---'
			body = content.substring(match[0].length); // Get everything after the YAML
		}

		// --- Requirement 2: Check for incompatibilities and reformat ---

		// Check for non-converted items and add warnings
		if (/\[\[.*\]\]/.test(body) || /!\[\[.*\]\]/.test(body)) {
			warnings.push('Internal links [[...]] and embeds ![[...]] were not converted and must be updated manually.');
		}
		if (/```dataview/.test(body)) {
			warnings.push('Dataview blocks were not converted and will not run in Quarto.');
		}

		// Reformat: Obsidian Comments (%%...%%) -> HTML/Quarto Comments ()
		body = body.replace(/%%([\s\S]*?)%%/g, '');

		// Reformat: Obsidian Callouts -> Quarto Callouts
		// Matches: > [!TYPE] Title \n > ...body...
		const calloutRegex = /^>\s*\[!(.*?)\](.*?)\n((?:^>.*\n?)*)/gm;
		body = body.replace(calloutRegex, (match, type, title, calloutBody) => {
			const calloutType = type.toLowerCase().trim();
			
			// Start Quarto callout block
			let qmdCallout = `\n::: {.callout-${calloutType}}\n`;
			
			// Add title if it exists
			if (title.trim()) {
				qmdCallout += `## ${title.trim()}\n`;
			}
			
			// Un-indent body (remove starting '>')
			const unquotedBody = calloutBody.replace(/^>\s?/gm, '');
			
			qmdCallout += `${unquotedBody}\n:::\n`;
			return qmdCallout;
		});

		// Combine YAML and processed body
		const qmdContent = yaml ? `${yaml}\n${body}` : body;
		
		return { qmdContent, warnings };
	}
}
