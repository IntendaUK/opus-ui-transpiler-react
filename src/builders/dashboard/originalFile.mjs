let originalFile;
let originalPath;

export const setOriginalFile = (_originalFile, _originalPath) => {
	originalFile = _originalFile;
	originalPath = _originalPath;
};

export const getOriginalFile = () => originalFile;

export const getOriginalPath = () => originalPath;
