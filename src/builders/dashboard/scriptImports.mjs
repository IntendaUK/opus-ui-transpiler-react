let scriptImports = [];

export const resetScriptImports = () => {
	scriptImports = [];
};

export const pushToScriptImports = entry => {
	if (scriptImports.some(({ type, path }) => type === entry.type && path === entry.path))
		return;

	scriptImports.push(entry);
};

export const getScriptImports = () => scriptImports;
