let mapFiles;

export const initMapFiles = _mapFiles => {
	mapFiles = _mapFiles;
};

export const getMapFilesEntry = key => {
	return mapFiles.get(key);
};
