module.exports = function (app) {

var plugin = {};

plugin.id = 'netAIS-plugin';
plugin.name = 'netAIS';
plugin.description = 'private AIS over Internet';

plugin.schema = { 	// при изменении схемы надо в сервере нажать Submit в настройках плугина, иначе схема будет та, что хранится у сервера
// The plugin schema
	title: 'netAIS',
	type: 'object',
	required: ['torHost', 'torPort'],
	properties: {
		netAISserverURIs: {
			type: 'array',
			title: 'netAIS private groups list',
			items: {
				type: 'object',
				required: ['onion'],
				properties: {
					enable: {
						type: 'boolean',
						title: 'enable group',
						default: true
					},
					name: {
						title: 'obvious name',
						type: 'string',
						default: 'GaladrielMap demo netAIS service'
					},
					onion: {
						type: 'string',
						title: '.onion address of group, required ',
						default: '2q6q4phwaduy4mly2mrujxlhpjg7el7z2b4u6s7spghylcd6bv3eqvyd.onion'
					},
				}
			}
		},
		noVehicleTimeout: {
			type: 'number',
			title: "Don't show vessel after continuous absence in netAIS, sec.",
			default: 600
		},
		interval: {
			type: 'number',
			title: 'Update netAIS data interval, sec.',
			default: 2
		},
		torHost: {
			type: 'string',
			title: 'your TOR host',
			default: 'localhost'
		},
		torPort: {
			type: 'string',
			title: 'your TOR port',
			default: '9050'
		},
		selfServer: {
			type: 'object',
			title: 'Your netAIS private group server',
			properties: {
				toggle: {
					type: 'boolean',
					title: 'enable self netAIS server',
					default: false
				},
				selfMember: {
					type: 'boolean',
					title: 'a member of own group',
					default: true
				},
				selfOnion: {
					type: 'string',
					title: 'your TOR .onion address for netAIS server',
					description: `You MUST configure TOR hidden service (https://www.torproject.org/docs/tor-onion-service.html.en)
					 to be netAIS work.\n
					 Add strings "\n
					 HiddenServiceDir /var/lib/tor/hidden_service_netAIS/\n
					 HiddenServicePort 80 localhost:3100\n
					 " to torrc config file and restart TOR\n
					 see your TOR .onion address by  # cat /var/lib/tor/hidden_service_netAIS/hostname

					`
				},
				netAISserverPort: {
					type: 'string',
					title: 'port of netAIS server',
					description: `This port bind to TOR hidden service in torrc config file as describe above. Don't change it without needing. 
					`,
					default: '3100'
				},
			}
		}
	},
};

var unsubscribes = []; 	// массив функций, которые отписываются от подписок (на обновления от сервера, например)

//	var netAISserverURIs = ['2q6q4phwaduy4mly2mrujxlhpjg7el7z2b4u6s7spghylcd6bv3eqvyd.onion']; 	// массив серверов netAIS, с которыми будем общаться. Ибо, в отличии от php версии, netAISclient у нас один на всех, а не на каждый сервер
//	var netAISserverURIs = ['stagersngpqcnubt.onion']; 	// массив серверов netAIS, с которыми будем общаться. Ибо, в отличии от php версии, netAISclient у нас один на всех, а не на каждый сервер
//	var netAISserverURIs = ['flibustahezeous3.onion']; 	// массив серверов netAIS, с которыми будем общаться. Ибо, в отличии от php версии, netAISclient у нас один на всех, а не на каждый сервер

plugin.start = function (options, restartPlugin) {

	// netAIS client
	//app.debug('options',options);
	const http = require('http');
	const url = require('url');
	const { SocksProxyAgent } = require('socks-proxy-agent');	
	const agent = new SocksProxyAgent('socks5h://'+options.torHost+':'+options.torPort);
	//app.debug('tor:',agent);
	app.debug('netAIS client started');
	// Сведения о себе для передачи
	var vehicle = {};
	vehicle.shipname = app.getSelfPath('name') ? app.getSelfPath('name') : undefined;
	vehicle.mmsi = app.getSelfPath('mmsi') ? app.getSelfPath('mmsi') : app.getSelfPath('uuid');
	vehicle.imo = app.getSelfPath('registrations.imo') ? app.getSelfPath('registrations.imo') : undefined;
	vehicle.callsign = app.getSelfPath('communication.callsignVhf') ? app.getSelfPath('communication.callsignVhf') : undefined;
	vehicle.shiptype = app.getSelfPath('design.aisShipType.value.id') ? app.getSelfPath('design.aisShipType.value.id') : undefined;
	vehicle.shiptype_text = app.getSelfPath('design.aisShipType.value.name') ? app.getSelfPath('design.aisShipType.value.name') : undefined;
	vehicle.draught = app.getSelfPath('design.draft.value.maximum') ? app.getSelfPath('design.draft.value.maximum') : undefined;
	vehicle.length = app.getSelfPath('design.length.value.overall') ? app.getSelfPath('design.length.value.overall') : undefined;
	vehicle.beam = app.getSelfPath('design.beam.value') ? app.getSelfPath('design.beam.value') : undefined;
	vehicle.netAIS = true;
	//app.debug('vehicle at start',vehicle);
	
	function updSelf(position){
		vehicle.status = app.getSelfPath('navigation.state') ? app.getSelfPath('navigation.state').value : undefined;
		vehicle.speed = app.getSelfPath('navigation.speedOverGround') ? app.getSelfPath('navigation.speedOverGround').value : undefined;
		vehicle.lon = position.longitude;
		vehicle.lat = position.latitude;
		vehicle.course = app.getSelfPath('navigation.courseOverGroundTrue') ? app.getSelfPath('navigation.courseOverGroundTrue').value *180/Math.PI : undefined;
		vehicle.heading = app.getSelfPath('navigation.headingTrue') ? Math.round(app.getSelfPath('navigation.headingTrue').value *180/Math.PI) : undefined;
		vehicle.destination = app.getSelfPath('navigation.destination.commonName') ? app.getSelfPath('navigation.destination.commonName').value : undefined;
		vehicle.eta = app.getSelfPath('navigation.destination.eta') ? app.getSelfPath('navigation.destination.eta').value : undefined;			
		//app.debug('navigation.datetime',app.getSelfPath('navigation.datetime'));
		vehicle.timestamp = app.getSelfPath('navigation.datetime') ? Math.round(new Date(app.getSelfPath('navigation.datetime').value).getTime()/1000) : Math.round(new Date().getTime()/1000); 	// navigation.datetime -- строка iso-8601, переводится в unix timestamp, в секундах
		if(vehicle.lon && vehicle.lat) return true;
		else return false
	} // end function updSelf

	function prepareDelta(vessel){
	// from netAIS vessel data create SignalK delta array
		let values = [];
		// name, mmsi, registrations, communication -- это имена свойств, находящихся по пути ""
		values = [
			{	// эта пурга непонятно с какой версии
				path: '',	// Или так правильно?
				value: {name: vessel.shipname}
				//path: 'name',	// Концептуально правильно так, но так не работает. mmsi и name дожны оба иметь path: ''
				//value: vessel.shipname
			},
			{
				path: '',
				value: {mmsi: vessel.mmsi}
				//path: 'mmsi', 	// при указании context: vessels.urn:mrn:imo:mmsi mmsi устанавливается само?
				//value: vessel.mmsi
			},
			{
				path: 'registrations',
				value:{imo: vessel.imo}
			},
			{
				//path: 'communication',
				//value: {callsignVhf: vessel.callsign}
				path: 'communication.callsignVhf',
				value: vessel.callsign
			},
			{
				//path: 'communication',
				//value: {netAIS: true}
				path: 'communication.netAIS',
				value: true
			},
			{
				path: 'navigation.position',
				value: {longitude: vessel.lon, latitude: vessel.lat}
			},
			{
				path: 'navigation.courseOverGroundTrue',
				value: vessel.course ? vessel.course * Math.PI / 180 : vessel.heading * Math.PI / 180
			},
			{
				path: 'navigation.speedOverGround',
				value: vessel.speed
			},
			{
				path: 'navigation.headingTrue',
				value: vessel.heading ? vessel.heading * Math.PI / 180 : vessel.course * Math.PI / 180
			},
			{
				path: 'navigation.datetime',
				value: new Date(vessel.timestamp*1000).toISOString()
			},
			{
				path: 'navigation.state',
				value: vessel.status
			},
			{
				path: 'navigation.destination',
				value: {commonName : vessel.destination, eta : vessel.eta}
			},
			{
				path: 'design.aisShipType',
				value: {id: vessel.shiptype,name : vessel.shiptype_text} 	// 
			},
			{
				path: 'design.draft',
				value:{"current": vessel.draught,"maximum":vessel.draught}
			},
			{
				path: 'design.length',
				value:{"overall": vessel.length}
			},
			{
				path: 'design.beam',
				value: vessel.beam
			},
		];
		//app.debug('values BEFORE ',values);
		for(let i=0;i<values.length;i++){
			if(values[i] == undefined) {
				values.splice(i,1);
				i--;
			}
			else if(values[i].value == undefined) {
				values.splice(i,1);
				i--;
			}
			else{
				//app.debug(values[i].value);
				if(typeof values[i].value === 'object'){
					for(const key in values[i].value) {
						//app.debug('key',key,'value',values[i].value[key]);
						if(key == 'undefined') {
							//app.debug('undefined key',key,'value',values[i].value[key]);
							delete values[i].value[key];
						}
						else if(values[i].value[key] === undefined) {
							//app.debug('key',key,'value',values[i].value[key]);
							delete values[i].value[key];
						}
					}
					if(JSON.stringify(values[i].value) == '{}') { 	// вот так через жопу определяется пустой объект. Есть и более черезжопные методы.
						values.splice(i,1);
						i--;
					}
				}
			}
		}
		return values;
	} // end function prepareDelta

	let stream = app.streambundle.getSelfStream('navigation.position'); 	// подписываемся на получение координат, чисто ради периодического вызова. Подписываться сразу на navigation бесполезно, потому что собственно в navigation ничего не может происходить, а события из вложенных структур (типа position) не "всплывают".
	if(!options.interval) options.interval = 2;
	stream = stream.debounceImmediate(options.interval * 1000); 	// каждую секунду, если не указано иного

	function doConnect(position) { 	// функция для обработки подписки
		// свежие сведения о себе
		if(! updSelf(position)) return; 	// не будем обращаться к серверам, если у нас нет своих координат
		//app.debug('vehicle',vehicle);
		
		if(! options.netAISserverURIs) {
			app.debug('Don\'t set server, bye.');
			app.debug('options.netAISserverURIs',options.netAISserverURIs);
			plugin.stop();
			app.setPluginStatus('Plugin stopped by no netAIS servers in config.');
			return;
		}
		const now = Math.round(new Date().getTime()/1000); 	// unix timestamp
		for(let netAISserverURI of options.netAISserverURIs){ 	// для каждого сервера netAIS, ибо клиент у нас один на всех
			//app.debug('netAISserverURI.onion',netAISserverURI.onion);
			//app.debug('tor:',agent);
			if(!netAISserverURI.enable) continue;
			if(!netAISserverURI.onion) continue;
			// связываемся с сервером
			//const uri = 'http://'+netAISserverURI.onion+'/netAISserver.php?member='+encodeURIComponent(JSON.stringify(vehicle));
			const uri = 'http://'+netAISserverURI.onion+'/?member='+encodeURIComponent(JSON.stringify(vehicle));
			//app.debug('uri:',uri);
			http.get(uri, {agent}, (res) => {
				const { statusCode } = res;
				const contentType = res.headers['content-type'];

				let error;
				// Any 2xx status code signals a successful response but
				// here we're only checking for 200.
				if (statusCode !== 200) {
					error = new Error(`\nRequest Failed. Status Code: ${statusCode}`);
				} 
				else if (!/^application\/json/.test(contentType)) {
					error = new Error('\nInvalid content-type.\n' + `Expected application/json but received ${contentType}`);
				}
				if (error) {
					app.debug(error.message);
					//app.debug(res.rawHeaders);
					// Consume response data to free up memory
					res.resume();
				}
				else {
					res.setEncoding('utf8');
					let rawData = '';
					res.on('data', (chunk) => { rawData += chunk; });
					res.on('end', () => {
						app.setPluginStatus('Normal run, connections ok.');
						//app.setPluginError('');
						//app.debug('rawData:',rawData);
						try {
							let netAISdata = JSON.parse(rawData);
							delete netAISdata[vehicle.mmsi]; 	// я сам есть в полученных
							//app.debug(netAISdata);
							// Получены данные netAIS, теперь отдадим их в SignalK

							for(const vessel in netAISdata) {
								if((now - netAISdata[vessel].timestamp) > options.noVehicleTimeout) continue; 	// протухшие и без метки времени -- не показываем
								const values = prepareDelta(netAISdata[vessel]);
								//app.debug('Добавляется судно',netAISdata[vessel].shipname);
								//app.debug('values AFTER ',values);
								app.handleMessage(plugin.id, {
									context: 'vessels.urn:mrn:imo:mmsi:'+netAISdata[vessel].mmsi,
									updates: [
										{
											values: values,
											source: { label: plugin.id },
											timestamp: new Date(netAISdata[vessel].timestamp*1000).toISOString(),
										}
									]
								});
							} 	// конец цикла по пароходам в netAISdata
							
						} catch (e) { 	// 	облом JSON.parse
							app.debug(e.message);
						}
					});
				}
			}).on('error', (e) => {
				app.debug(`Connect to netAIS server got error: ${e.message}`);
				app.setPluginError(e.message);
				app.setPluginStatus(`Connect to netAIS server got error, continued attempts.`);
				if(e.message.includes(`:${options.torPort}`)){	// проблема с локальным tor'ом. Но его перезапустят?
					//app.error(`TOR not run? ${e.message}`);
					//app.debug(`TOR not run? ${e.message}`);
					app.setPluginError(`TOR not run? ${e.message}`);
					app.setPluginStatus('Plugin inactive by no local TOR.');
					//plugin.stop();
					return;
				}
			});
		}
	}; // end function doConnect
	
	unsubscrF = stream.onValue(doConnect); 	// назначаем функцию для обработки событий в потоке. Результат -- функция отписки от этого события (ну вот так...)
	unsubscribes.push(unsubscrF); 	// складываем функцию отписки в кучку, для отписки в plugin.stop

	// netAIS server
	const netAIShost = 'localhost';
	const netAISport = options.selfServer.netAISserverPort;
	let netAISserverData = {};
	
	function netAISserver(req, res){
		try {
			let member = JSON.parse(url.parse(req.url,true).query.member); 	// member -- это, собственно, требуемый параметр в запросе
			//app.debug('member',member);
			//app.debug('netAISserverData',netAISserverData);
			if(member.lon && member.lat) { 	// прислали достаточно информации
				// запишем присланное в общий файл
				if(member.mmsi){
					if(!netAISserverData[member.mmsi]) netAISserverData[member.mmsi] = {};
					for(const opt in member){
						netAISserverData[member.mmsi][opt] = member[opt];
					}
					netAISserverData[member.mmsi].netAIS = true;
				}
				//app.debug('options.selfServer.selfMember',options.selfServer.selfMember, app.getSelfPath('navigation.position').value);
				//app.debug('netAISserverData',netAISserverData);
				// проверим, что в общем файле протухло
				const now = Math.round(new Date().getTime()/1000); 	// unix timestamp
				//app.debug('now',now,'options.noVehicleTimeout',options.noVehicleTimeout);
				for(const vessel in netAISserverData){
					if((now - netAISserverData[vessel].timestamp) > options.noVehicleTimeout){
						delete netAISserverData[vessel]; 
					}
				}
				//app.debug('netAISserverData',netAISserverData);
				// добавим в общий файл себя, а себе -- всех остальных, если указано и у нас есть свои координаты
				if(options.selfServer.selfMember && updSelf(app.getSelfPath('navigation.position').value)){ 	
					for(const vessel in netAISserverData) {
						const values = prepareDelta(netAISserverData[vessel]);
						app.handleMessage(plugin.id, {
							context: 'vessels.urn:mrn:imo:mmsi:'+netAISserverData[vessel].mmsi,
							updates: [
								{
									values: values,
									source: { label: plugin.id },
									timestamp: new Date(netAISserverData[vessel].timestamp*1000).toISOString(),
								}
							]
						})
					} 	// конец цикла по пароходам в netAISserverData
					netAISserverData[vehicle.mmsi] = vehicle;
				}
				res.statusCode = 200;
			}
			else {
				netAISserverData = {error:"Spatial info required, sorry."};
				res.statusCode = 400;
			}
		}
		catch (e) { 	// 	облом JSON.parse, включая отсутствие member и прочую фигню
			app.error('Bad request:',e.message);
			//app.debug('Bad request:',e.message);
			netAISserverData = {error: 'Bad request: '+e.message};
			res.statusCode = 400;
		}
		//res.setHeader('Content-Type', 'text/plain');
		res.setHeader('Content-Type', 'application/json;charset=utf-8;');
		res.write(JSON.stringify(netAISserverData));
		res.end('\n');
	} // end function netAISserver
	
	if(options.selfServer.toggle) {
		if(options.selfServer.selfOnion){
			const server = http.createServer(netAISserver);
			server.listen(netAISport, netAIShost, () => {
				app.debug(`netAIS server running at http://${netAIShost}:${netAISport}/`);
			});
			unsubscribes.push(() => { 	// функция остановки сервера при остановке плугина
				server.close();
				app.debug('netAIS server stopped');
			})
		}
		else {
			options.selfServer.toggle = false;
			app.savePluginOptions(options, () => {app.debug('netAIS server switched off')});
			app.error('TOR hidden service not configure, netAIS server not started.');
			//app.debug('TOR hidden service not configure, netAIS server not started.');
			app.setPluginError('TOR hidden service not configure, netAIS server not started.');
		}
	}

}; // end function plugin.start

plugin.stop = function () {
// 
	//app.debug(unsubscribes);
	app.debug('netAIS stopped');
	unsubscribes.forEach(f => f());	// отписаться от всех подписок и всё остальное, что положили в unsubscribes
	unsubscribes = [];
	// Обнулим координаты у тех пароходов, которые получены по netAIS
	const vessels = app.getPath('vessels');
	for( let vessel in vessels){
		if(!(vessels[vessel].communication && vessels[vessel].communication.value && vessels[vessel].communication.value.netAIS)) continue;
		//app.debug('vessel',vessel);
		app.handleMessage(plugin.id, {
			context: 'vessels.'+vessel,
			updates: [
				{
					values: [
						{
							path: 'navigation.position',
							value: {longitude: null, latitude: null}
						},
						{
							path: 'navigation.courseOverGroundTrue',
							value: null	// undefined тут почему-то Illegal value in delta:{"path":"navigation.courseOverGroundTrue"}
						},
						{
							path: 'navigation.speedOverGround',
							value: null	// undefined тут почему-то Illegal value in delta:{"path":"navigation.speedOverGround"}
						},
						{
							path: 'navigation.headingTrue',
							value: null	// undefined тут почему-то Illegal value in delta:{"path":"navigation.headingTrue"}
						},
					],
					source: { label: plugin.id },
					timestamp: new Date().toISOString(),
				}
			]
		})
	}		
	stream = null;
	app.setPluginStatus('Plugin stopped');
};

return plugin;
};
