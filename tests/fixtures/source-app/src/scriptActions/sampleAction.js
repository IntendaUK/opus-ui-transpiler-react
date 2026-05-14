const sampleAction = ({ setState, message }) => {
	setState({
		key: 'fixtureMessage',
		value: message
	});
};

export default sampleAction;