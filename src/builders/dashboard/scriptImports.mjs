let scriptImports = [];

export const resetScriptImports = () => {
	scriptImports = [];
};

export const pushToScriptImports = entry => {
	scriptImports.push(entry);
};

export const getScriptImports = () => scriptImports;
