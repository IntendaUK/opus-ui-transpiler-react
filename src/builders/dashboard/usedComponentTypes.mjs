let usedComponentTypes = [];

export const resetUsedComponentTypes = () => {
	usedComponentTypes = [];
};

export const pushToUsedComponentTypes = entry => {
	usedComponentTypes.push(entry);
};

export const getUsedComponentTypes = () => usedComponentTypes;
