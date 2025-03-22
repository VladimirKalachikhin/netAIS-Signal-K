module.exports = function (app) {
const { execSync } = require('child_process');
const os = require('os');
//const url = require('node:url');
var plugin = {};
/*
Есть три сущности:
1) Состояние собственноно судна: координаты, размеры, статус и тревоги
2) Сколько - то чужих приватных групп, на которые есть подписка. Им отсылается своё состояние, получается сколько-то чужих.
3) Собственная приватная группа, обслуживаемая своим сервером. Сервер получает состояния от каждого подписчика, возвращает каждому состояния всех.

Если в данных netAIS приходит MOB, то режим устанавливается или дополняется, если у себя
MOB установлен GaladrielMap, иначе - нет.

plugin.start
	// Функции клиента
	doOnValueTPV(position)
	netAISclient()
	inToSignalK(netAISdata)
	gpsdPROXYMOBtoGeoJSON(MOBdata)
	gpsdPROXYGeoJSONtoMOB(mobMarkerJSON,status)
	SignalKMOBtoGeoJSON(MOBdata)
	SignalKGeoJSONtoMOB(mobMarkerJSON,status,label='galadrielmap_sk')
	updSelf(position)
	prepareDelta(vessel)

	// Функции сервера
	netAISserverHelper(req, res)

	// Всякие функции
	function checkTOR()
	
plugin.stop

*/
plugin.id = 'netAIS';
plugin.name = 'netAIS';
plugin.description = 'private AIS over Internet';

plugin.schema = { 	// при изменении схемы надо в сервере нажать Submit в настройках плугина, иначе схема будет та, что хранится у сервера
// The plugin schema
	title: 'netAIS',
	type: 'object',
	required: [],
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
						title: 'address of group, required ',
						default: 'eqavt5cdur7vbzoejquiwviok4tfexy32sggxdxujm75uiljqi5g27ad.onion',
						description: `This can be a real ip address, VPN or Yggdrasil address if you are not using TOR. The [] in the ipv6 addresses is required`
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
			title: 'Min update interval of the netAIS data, sec.',
			default: 30
		},
		torHost: {
			type: 'string',
			title: 'your TOR host',
			default: 'localhost',
			description: `Your TOR proxy for connect to other private groups with TOR transport. May be omitted if you are not using TOR transport.`
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
					title: 'Is a member of own group. It is not mandatory.',
					default: true
				},
				netAIShost: {
					type: 'string',
					title: 'host of yor netAIS server',
					description: `This host may be configure in torrc config file, if you use TOR as transport for self group.`,
					default: '[::]'
				},
				netAISPort: {
					type: 'string',
					title: 'port of netAIS server',
					description: `This port may be to bind to TOR hidden service in torrc config file, if you use TOR as transport for self group.`,
					default: '3100'
				},
			}
		}
	},
};

var unsubscribes = []; 	// массив функций, которые отписываются от подписок (на обновления от сервера, например)

plugin.start = function (options, restartPlugin) {
	// netAIS client
	//app.debug('options',options);
	const http = require('http');
	const url = require('url');
	app.debug('netAIS client started');
	let SKdashboardStatusString = '';	// строка для сбора сообщений, выводимых в SignalK Admin panel
	let MOBtimestamp = 0;	// unix time установки/изменения режима MOB, если этот режим был отсюда же и установлен.
	let selfTransport = {};
	let agent;
	if(options.torHost){	// если указан proxy, например -- tor. 
		if(!options.torPort) options.torPort = '9050';
		checkTOR();	// там проверяется только факт, что указанный порт обслуживается каким-то сетевым интерфейсом. Так что это может быть любым socks proxy, не только tor. А нафига?
		if(selfTransport.tor !== false){	// если не явно нет, но может и не удалось проверить
			const { SocksProxyAgent } = require('socks-proxy-agent');	
			agent = new SocksProxyAgent('socks5h://'+options.torHost+':'+options.torPort);
		};
	};
	// Проверим, есть ли в url указанных чужих групп адреса tor или yggdrasil
	//app.debug('options.netAISserverURIs:',options.netAISserverURIs);
	if(options.netAISserverURIs){	// когда нет ни одной сконфигурированной чужой группы - это не пустой список, как можно было бы подумать, а undefined
		let optionsChanged = false;
		for(const server of options.netAISserverURIs){	// для каждой включенной чужой группы
			if(!server.enable) continue;
			if(server.onion.includes('.onion')) {	// если её транспорт - tor
				if(typeof selfTransport.tor === "undefined") selfTransport.tor = checkTOR();	// если ещё не проверяли - проверим наличие tor
				if(selfTransport.tor === false){	// если tor'а точно нет, а не неудалось узнать
					server.enable = false;
					optionsChanged = true;
				};
			}
			else if(server.onion.includes('[2') || server.onion.includes('[3')) {
				if(typeof selfTransport.yggdrasil === "undefined") selfTransport.yggdrasil = checkYgg();	// если ещё не проверяли - проверим наличие yggdrasil
				//app.debug('selfTransport.yggdrasil:',selfTransport,typeof selfTransport.yggdrasil);
				if(selfTransport.yggdrasil === false){	// если yggdrasil'а точно нет, а не неудалось узнать
					server.enable = false;
					optionsChanged = true;
				};
			};
		};
		//app.debug('selfTransport:',selfTransport);
		if(optionsChanged) app.savePluginOptions(options, () => {app.debug('Plugin options saved by transpot unaccessed.')});
	};
	{	// Выведем сообщение в SignalK Dashboard
	let str='';
	if(selfTransport.tor === false) str+='The TOR transport is required, but not found. ';
	else if(selfTransport.tor === null) str+='The TOR transport is required, but it was not possible to find it. ';
	if(selfTransport.yggdrasil === false) str+='\nThe Yggdrasil transport is required, but not found. ';
	app.setPluginError(str);
	};
	
	// Решим, работаем или нет
	if(!options.selfServer.toggle){	// собственный сервер не должен быть включен
		let isGroups = false;
		if(options.netAISserverURIs){
			for(const server of options.netAISserverURIs){	// для каждой чужой группы
				if(server.enable){
					isGroups = true;
					break;
				};
			};
		};
		if(!isGroups){
			app.debug("Plugin stopped by no netAIS groups in config and no self server.");
			app.setPluginError('Plugin stopped by no netAIS groups in config and no self server.');
			plugin.stop();
			return;
		}
		else {
			SKdashboardStatusString += `The netAIS clients started\n`
		};
	};
	// Итак, работаем.
	
	// Сведения о себе для передачи
	var vehicle = {};
	vehicle.shipname = app.getSelfPath('name') ? app.getSelfPath('name') : undefined;
	vehicle.mmsi = app.getSelfPath('mmsi') ? app.getSelfPath('mmsi') : app.getSelfPath('uuid');	// однако, uuid не назначается автоматически, и обычно его нет. И mmsi тоже нет.
	vehicle.imo = app.getSelfPath('registrations.imo') ? app.getSelfPath('registrations.imo') : undefined;
	vehicle.callsign = app.getSelfPath('communication.callsignVhf') ? app.getSelfPath('communication.callsignVhf') : undefined;
	vehicle.shiptype = app.getSelfPath('design.aisShipType.value.id') ? app.getSelfPath('design.aisShipType.value.id') : undefined;
	vehicle.shiptype_text = app.getSelfPath('design.aisShipType.value.name') ? app.getSelfPath('design.aisShipType.value.name') : undefined;
	vehicle.draught = app.getSelfPath('design.draft.value.maximum') ? app.getSelfPath('design.draft.value.maximum') : undefined;
	vehicle.length = app.getSelfPath('design.length.value.overall') ? app.getSelfPath('design.length.value.overall') : undefined;
	vehicle.beam = app.getSelfPath('design.beam.value') ? app.getSelfPath('design.beam.value') : undefined;
	vehicle.netAIS = true;
	//app.debug('vehicle at start',vehicle);
	var statusMOB;
	
	// Клиент: рассылает своё состояние всем указанным серверам чужих групп.
	// подписываемся на получение координат, чисто ради периодического вызова.
	// Подписываться сразу на navigation бесполезно, потому что собственно в navigation
	// ничего не может происходить, а события из вложенных структур (типа position) не "всплывают".
	// Используются методы непосредственно https://baconjs.github.io/ , потому что в SignalK не подумали.
	// 	Подписка на координаты
	// На самом деле, поприходу координат осуществляется не только отсылка чужим серверам
	// своего положения, но и, главное, получение от них информации об остальных.
	// Можно считать, что это способ организации опроса чужих серверов.
	// Поэтому устанавливается debounceImmediate
	let TPVstream = app.streambundle.getSelfStream('navigation.position'); 	
	if(!options.interval) options.interval = 60;
	// Это не то, что я думал, а что - я так и не понял.
	// А, это, видимо, "не чаще, чем". Но всё равно по событию.
	TPVstream = TPVstream.debounceImmediate(options.interval * 1000); 	// каждую , если не указано иного
	const unsubscrTPV = TPVstream.onValue(doOnValueTPV); 	// назначаем функцию для обработки событий в потоке. Результат -- функция отписки от этого события (ну вот так...)
	unsubscribes.push(unsubscrTPV); 	// складываем функцию отписки в кучку, для отписки в plugin.stop

	// Сервер своей группы.
	// Обслуживаемые этим web сервером host и port
	// tor переправляет запросы к себе на этот host:port, как это описано в его, tor, конфигурации.
	// Но штатно мы просо обслуживаем эти host:port, как бы к нему не обращались, и есть там tor, или нет.
	const netAIShost = options.selfServer.netAIShost ? options.selfServer.netAIShost : '::';	//
	const netAISport = options.selfServer.netAISPort ? options.selfServer.netAISPort : '';
	let netAISserverData = {};	// данные netAIS своей группы в формате gpsdPROXY
	if(options.selfServer.toggle) {
		const HTTPserver = http.createServer(netAISserverHelper);
		HTTPserver.listen(netAISport, netAIShost.replace(/^\[+|\]+$/g, ""), () => {	// там именно сперва порт, потом хост. Извращенцы.
				let str = netAISport ? `:${netAISport}` : ''
				app.debug(`Self netAIS server started at http://${netAIShost}${str}/\n`);
				SKdashboardStatusString += `Self netAIS server started at http://${netAIShost}${str}/\n`
			});
		unsubscribes.push(() => { 	// функция остановки сервера при остановке плугина
			HTTPserver.close();	// это, типа, замыкание? Ну не жопа ли...
			app.debug('netAIS server stopped');
		});
	};

	app.setPluginStatus(SKdashboardStatusString);	// выведем сообщение в веб-панель
	// Всё, плагин стартовал и работает.




	// Функции клиента
	function doOnValueTPV(position) { 	
	/*/ функция для обработки подписки, реализующая netAIS client для всех имеющихся
	чужих групп 
	*/
		// свежие сведения о себе
		//if(! updSelf(position)) return; 	// не будем обращаться к серверам, если у нас нет своих координат
		updSelf(position); 	// будем обращаться к серверам, даже если у нас нет своих координат - у нас может быть MOB
		//app.debug('[doOnValueTPV] vehicle=',vehicle);
		//app.debug('[doOnValueTPV] statusMOB:',statusMOB);
		netAISclient();
	}; // end function doOnValueTPV
	
	function netAISclient(){
	/* Собственно функциональность клиента 
		global vehicle statusMOB, обноаляется в updSelf,
		одномерный массив key:value данных AIS одного судна
	*/
		for(let netAISserverURI of options.netAISserverURIs){ 	// для каждого сервера netAIS, ибо клиент у нас один на всех
			if(!netAISserverURI.enable) continue;	// группа выключена
			if(!netAISserverURI.onion) continue;	// нет адреса чужого сервера
			// Поскольку url.parse лютое говно, и ничего не делает, будем проверять url руками
			if(!netAISserverURI.onion.startsWith('http')) netAISserverURI.onion = 'http://'+netAISserverURI.onion;
			if(!netAISserverURI.onion.endsWith('/')) netAISserverURI.onion += '/';
			// связываемся с сервером
			//app.debug('[netAISclient] для отправки, vehicle:',vehicle,'statusMOB',statusMOB);
			let memberStr = '';
			if((vehicle.lon !== undefined) && (vehicle.lat !== undefined)) memberStr = '?member='+encodeURIComponent(JSON.stringify(vehicle));
			let mobStr = '';
			if(statusMOB) {
				let mobMarkerJSON = SignalKMOBtoGeoJSON(statusMOB.value);	// функция из GaladrielMap SignalK ed.
				//app.debug('[netAISclient] mobMarkerJSON:',JSON.stringify(mobMarkerJSON));
				let status = true;
				if(!mobMarkerJSON || (statusMOB.value.state == 'normal')) status = false;	// режима MOB нет
				mobStr = gpsdPROXYGeoJSONtoMOB(mobMarkerJSON,status);
				//app.debug('[netAISclient] mobStr:',mobStr);
				mobStr = '&mob='+encodeURIComponent(JSON.stringify(mobStr));
			};
			const uri = netAISserverURI.onion+memberStr+mobStr;
			//app.debug('[netAISclient] uri:',uri);
			let agnt;
			if(netAISserverURI.onion.includes('.onion')) agnt = agent;
			http.get(uri, {agent: agnt}, (res) => {	// отправим и получим
				const { statusCode } = res;
				const contentType = res.headers['content-type'];
				let str=``;
				if (statusCode !== 200) {
					str=`Request failed with ${statusCode} to ${netAISserverURI.onion}`;
				} 
				else if (!/^application\/json/.test(contentType)) {
					str=`Request to other netAIS server failed: `;
					str+='Invalid content-type. ' + `Expected application/json but received ${contentType}`;
				}
				if (str) {
					//app.debug(str);
					//app.debug('[netAISclient] rawHeaders:',res.rawHeaders);
					app.setPluginError(str);
					res.resume();	// Consume response data to free up memory
				}
				else {
					res.setEncoding('utf8');
					let rawData = '';
					res.on('data', (chunk) => { rawData += chunk; });
					res.on('end', () => {
						app.setPluginStatus(`Normal run, connections to ${netAISserverURI.onion} is ok.`);	// сообщение нужно периодически обновлять, ибо предыдущее висит вечно
						//app.setPluginError('');
						//app.debug('[netAISclient] rawData:',rawData);
						let netAISdata;
						try {
							netAISdata = JSON.parse(rawData);
						}
						catch (e) { 	// 	облом JSON.parse
							app.debug('[doOnValueTPV] Error in data from other:',e.message);
						};
						delete netAISdata[vehicle.mmsi]; 	// я сам есть в полученных
						delete netAISdata['972'+vehicle.mmsi.substring(3)]; 	// мой MOB есть в полученных
						//app.debug('\nПолучены данные netAIS:',JSON.stringify(netAISdata));
						
						// Получены данные netAIS, теперь отдадим их в SignalK
						inToSignalK(netAISdata);
					});
				}
			}).on('error', (e) => {
				let str=`Connect to other netAIS server got error: ${e.message} `;
				if(e.message.includes(`:${options.torPort}`)){	// проблема с локальным tor'ом. Но его перезапустят?
					str += `TOR not run?`;
				}
				app.debug(str);
				app.setPluginError(str);	// оно почему-то показывается в Status, а не в Last Error...
			});
		};
	}; // end function netAISclient
	
	function inToSignalK(netAISdata){
	/* Передаёт пришедние от чужого сервера данные в SignalK 
	netAISdata - в формате gpsdPROXY AIS
	*/
		const now = Math.round(new Date().getTime()/1000); 	// unix timestamp
		const mySARTmmsi = '972'+vehicle.mmsi.substring(3);
		for(const vessel in netAISdata) {
			//app.debug('[inToSignalK] vessel=',vessel,'vehicle.mmsi=',vehicle.mmsi,'mySARTmmsi=',mySARTmmsi);
			if(vessel == vehicle.mmsi) continue;	// я сам
			if(vessel == mySARTmmsi) continue;	// мой MOB
			if(vessel.startsWith('972') || vessel.startsWith('974')){	// сообщение MOB или EPIRB
				// Переделаем объект MOB в GeoJSON, кто бы там MOB не выставлял.
				let mobMarkerJSON=null;
				//app.debug('[inToSignalK] statusMOB.value:',statusMOB ? JSON.stringify(statusMOB.value) : 'no statusMOB');
				if(statusMOB) mobMarkerJSON = SignalKMOBtoGeoJSON(statusMOB.value);
				//app.debug('[inToSignalK] mobMarkerJSON:',JSON.stringify(mobMarkerJSON));
				//app.debug('[inToSignalK] Получены данные netAIS MOB:',netAISdata[vessel]);
				// Если чужой MOB не меняется, а он не меняется, то завершение местного режима
				// MOB приведёт к тому, что моб от netAIS навсегда перестанет показываться, до его изменения.
				// Хотя бы текущего маркера.
				// Фича?
				if(mobMarkerJSON && mobMarkerJSON.properties.timestamp >= netAISdata[vessel].timestamp) continue;
				//app.debug(`Получены свежие данные netAIS MOB от ${vessel}:`,JSON.stringify(netAISdata[vessel]));
				//app.debug('Текущее приведённое состояние MOB:',JSON.stringify(mobMarkerJSON));
				let delta = null;
				// Хрен его знает, почему там передаётся не сразу GeoJSON, но так повелось. 
				// Потому что оно в формате gpsdPROXY, а вот там - так повелось.
				// Поэтому из пришедшего надо сделать GeoJSON.
				if(netAISdata[vessel].status){	//  в пришедших данных есть статус MOB
					if(mobMarkerJSON && statusMOB.value && statusMOB.value.state != 'normal'){	// режим MOB как таковой есть
						// У нас есть режим MOB, возможно, от netAIS, возможно, свой, причём известной нам конструкции
						// Пришедшие точки там уже могут быть, причём от одного mmsi - сколько хочешь точек.
						// Поэтому нужно взять в пришедшем все точки от одного mmsi, удалить
						// из нашего MOB все точки от этого mmsi, а потом добавить в наш MOB
						// точки из пришедшего с этим mmsi.
						let yetDeleted = new Set();
						let isCurrent;
						for(const point of netAISdata[vessel].points){
							//app.debug('[inToSignalK] point:',point,vehicle.mmsi);
							if(point.mmsi == vehicle.mmsi) continue;	// игнорируем информацию о себе, пришедшую со стороны
							//app.debug('Пришла точка от',point.mmsi,'уже удалены точки от',yetDeleted);
							if(!yetDeleted.has(point.mmsi)){	// если точки с mmsi этой точки ещё не удаляли из маркера
								for(let i=mobMarkerJSON.features.length-1; i>=0; --i){	// просматриваем с конца, потому что при .splice массив переиндицируется
									//app.debug('проматриваем с конца: i',i,JSON.stringify(mobMarkerJSON.features[i]));
									if(mobMarkerJSON.features[i].geometry.type != 'Point') continue;
									if(mobMarkerJSON.features[i].properties.mmsi != point.mmsi) continue;
									if(!isCurrent) isCurrent = mobMarkerJSON.features[i].properties.current;	// какая-то точка от этого mmsi была current
									//app.debug('удаляем',mobMarkerJSON.features[i],'isCurrent=',isCurrent);
									mobMarkerJSON.features.splice(i,1);	// удалим точку
									yetDeleted.add(point.mmsi);
								};
								if(!yetDeleted.has(point.mmsi)) yetDeleted.add(point.mmsi);	// этой точки не было в маркере
							};
							// пришедшей точки нет в имеющемся объекте MOB сервера SignalK.
							// Добавим point 
							mobMarkerJSON.features.push({
								"type": "Feature",
								"properties": {
									"mmsi": point.mmsi,	// mmsi используется для идентификации точки в объекте MOB
									"current": (Boolean(point.current) && isCurrent) ? true : false,	// если какая-то точка от этого mmsi была current, и эта присланная точка - current
									"safety_related_text": String(point.safety_related_text)
								},
								"geometry": {
									"type": "Point",
									"coordinates": point.coordinates
								}
							});
						};
						mobMarkerJSON.properties.timestamp = netAISdata[vessel].timestamp;	// обновим timestamp
						delta = SignalKGeoJSONtoMOB(mobMarkerJSON,true,plugin.id);	// This function is from the GaladrielMap SignalK edition.
					}
					else {	 //app.debug('у нас нет режима MOB - начнём его');
						// Однако, если у нас есть завершённый режим MOB, который был
						// завершён позже метки времени пришедшего - игнорируем пришедший.
						// Таким образом, получив чужой MOB, а потом выключив свой, поднятый на основании чужого,
						// мы сможем игнорировать чужой MOB до тех пор, пока тот не изменится.
						if(statusMOB && Math.round(Date.parse(statusMOB.timestamp)/1000) >= netAISdata[vessel].timestamp) continue;
						mobMarkerJSON = gpsdPROXYMOBtoGeoJSON(netAISdata[vessel]);
						delta = SignalKGeoJSONtoMOB(mobMarkerJSON,true,plugin.id);	// This function is from the GaladrielMap SignalK edition.
					};
				}
				else{ 	// иначе - в пришедших данных нет статуса MOB
					if(mobMarkerJSON && (statusMOB.value.state != 'normal')){	// режим MOB у нас есть, что не удивительно
						// В пришедших данных, несмотря на признак, что режим MOB выключен,
						// должны быть точки, в отношении которых кто-то выключил режим MOB.
						// Тогда мы удаляем эти точки из своего MOB.
						let yetDeleted = new Set();
						for(const point of netAISdata[vessel].points){
							if(point.mmsi == vehicle.mmsi) continue;	// игнорируем информацию о себе, пришедшую со стороны
							if(!yetDeleted.has(point.mmsi)){	// если точки с mmsi этой точки ещё не удалялм из маркера
								for(let i=mobMarkerJSON.features.length-1; i>=0; --i){	// просматриваем с конца, потому что при .splice массив переиндицируется
									if(mobMarkerJSON.features[i].geometry.type != 'Point') continue;
									if(mobMarkerJSON.features[i].properties.mmsi != point.mmsi) continue;
									//app.debug('Delete MOB point',mobMarkerJSON.features[i]);
									mobMarkerJSON.features.splice(i,1);	// удалим точку
									yetDeleted.add(point.mmsi);
								};
							};
						};
						let status=true;
						if(mobMarkerJSON.features.length < 2) status = false;	// не осталось ни одной точки, только линия - прекратим режим MOB
						mobMarkerJSON.properties.timestamp = netAISdata[vessel].timestamp;	// обновим timestamp
						delta = SignalKGeoJSONtoMOB(mobMarkerJSON,status,plugin.id);	// This function is from the GaladrielMap SignalK edition.
					}
					else {	// У нас режима MOB нет.
					};
				};
				//app.debug('[inToSignalK] delta по свежему сообщению MOB:',delta.updates[0].values);
				//app.debug('[inToSignalK] delta по свежему сообщению MOB:',JSON.stringify(delta));
				if(delta) {
					app.handleMessage(plugin.id, delta);	// пошлём delta серверу SignalK
					MOBtimestamp = netAISdata[vessel].timestamp;
				};
			}
			else {	// netAIS vessel
				if((now - netAISdata[vessel].timestamp) > options.noVehicleTimeout) continue; 	// протухшие и без метки времени -- не показываем
				const values = prepareDelta(netAISdata[vessel]);
				//app.debug('Добавляется судно',netAISdata[vessel].shipname,new Date(netAISdata[vessel].timestamp*1000).toISOString());
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
			};
		}; 	// конец цикла по пароходам в netAISdata
	}; // end function inToSignalK
	

	function gpsdPROXYMOBtoGeoJSON(MOBdata){
	/* Переделывает объект MOB из формата gpsdPROXY в mobMarkerJSON: Leaflet GeoJSON для GaladrielMap */
		//console.log('[gpsdPROXYMOBtoGeoJSON] MOBdata:',MOBdata);
		let mobMarkerJSON = {
			"type":"FeatureCollection",
			"features":[],
			"properties": {
				"timestamp": MOBdata.timestamp
			}
		};
		for(const point of MOBdata.points){
			const feature = {	
				"type":"Feature",
				"properties":{
					"current": Boolean(point.current),
					"mmsi": String(point.mmsi),
					"safety_related_text": String(point.safety_related_text)
				},
				"geometry":{
					"type":"Point",
					"coordinates": point.coordinates
				}
			};
			mobMarkerJSON.features.push(feature);
		};
		//console.log('[gpsdPROXYMOBtoGeoJSON] mobMarkerJSON:',mobMarkerJSON);
		return mobMarkerJSON;
	}; // end function gpsdPROXYMOBtoGeoJSON
	
	function gpsdPROXYGeoJSONtoMOB(mobMarkerJSON,status){
	/* Переделывает Leaflet GeoJSON мультислоя mobMarker в объект MOB формата gpsdPROXY 
	ИЗМЕНЕНО по сравнению с оригиналом в строке "timestamp": mobMarkerJSON.properties.timestamp,
	ИЗМЕНЕНО по сравнению с оригиналом в строке "source": '972'+vehicle.mmsi.substring(3)
	*/
	//console.log('[GeoJSONtoMOB] mobMarkerJSON:',mobMarkerJSON);
		let MOB={
			"class": 'MOB',
			"status": status,
			"points": [],
			"timestamp": mobMarkerJSON.properties.timestamp,
			"source": '972'+vehicle.mmsi.substring(3)
		};
		for(let feature of mobMarkerJSON.features){
			switch(feature.geometry.type){
			case "Point":
				MOB.points.push({
					'coordinates':feature.geometry.coordinates,
					'current':feature.properties.current,
					'mmsi':feature.properties.mmsi,
					'safety_related_text':feature.properties.safety_related_text
				});
				break;
			case "LineString":
				break;
			};
		};
		return MOB;
	}; // end function gpsdPROXYGeoJSONtoMOB

	function SignalKMOBtoGeoJSON(MOBdata){
	/* Переделывает объект MOB из формата SignalK notifications.mob в mobMarkerJSON: Leaflet GeoJSON для GaladrielMap */
		//console.log('[SignalKMOBtoGeoJSON] MOBdata:',MOBdata);
		let mobMarkerJSON=null;
		if(!MOBdata) return mobMarkerJSON;
		let timestamp=null;
		if(MOBdata.position && MOBdata.position.properties){	// Это GeoJSON
			timestamp = MOBdata.position.properties.timestamp;
		}
		else if(MOBdata.data && MOBdata.data.timestamp){	// это alarm от Freeboard
			timestamp = Math.round(Date.parse(MOBdata.data.timestamp)/1000);
		}
		else if(MOBdata.timestamp){
			timestamp = Math.round(Date.parse(MOBdata.timestamp)/1000);
		};
		//console.log('[SignalKMOBtoGeoJSON] MOBdata.position:',MOBdata.position);
		//console.log('[SignalKMOBtoGeoJSON] timestamp:',timestamp);
		if(MOBdata.position && MOBdata.position.features){	// Это GeoJSON
			mobMarkerJSON = MOBdata.position;	// Это GeoJSON
			if(!mobMarkerJSON.properties) mobMarkerJSON.properties = {};
			mobMarkerJSON.properties.timestamp = timestamp;	// Если я правильно понимаю, это будет штамп последнего изменения в любом случае, потому что цикл по источникам в порядке поступления изменений?
			//console.log('[SignalKMOBtoGeoJSON] mobMarkerJSON from GeoJSON:',mobMarkerJSON);
		}
		else{
			let mobPosition; 
			if(MOBdata.data && MOBdata.data.position){	// это alarm от Freeboard
				// mob as described https://github.com/SignalK/signalk-server/pull/1560
				// при этом у этих кретинов может быть "position": "No vessel position data."
				mobPosition = {'longitude': MOBdata.data.position.longitude,'latitude': MOBdata.data.position.latitude};
			}
			else {
				if(MOBdata.position){
					const s = JSON.stringify(MOBdata.position);
					if(s.includes('longitude') && s.includes('latitude')){
						mobPosition = {'longitude': MOBdata.position.longitude,'latitude': MOBdata.position.latitude};
					}
					else if(s.includes('lng') && s.includes('lat')){
						mobPosition = {'longitude': MOBdata.position.lng,'latitude': MOBdata.position.lat};
					}
					else if(s.includes('lon') && s.includes('lat')){
						mobPosition = {'longitude': MOBdata.position.lon,'latitude': MOBdata.position.lat};
					}
					else if(Array.isArray(MOBdata.position)){
						mobPosition = {'longitude': MOBdata.position[0],'latitude': MOBdata.position[1]};
					};
				}
				else{
					const s = JSON.stringify(MOBdata);
					if(s.includes('longitude') && s.includes('latitude')){
						mobPosition = {'longitude': MOBdata.longitude,'latitude': MOBdata.latitude};
					}
					else if(s.includes('lng') && s.includes('lat')){
						mobPosition = {'longitude': MOBdata.lng,'latitude': MOBdata.lat};
					}
					else if(s.includes('lon') && s.includes('lat')){
						mobPosition = {'longitude': MOBdata.lon,'latitude': MOBdata.lat};
					}
					else if(Array.isArray(MOBdata)){
						mobPosition = {'longitude': MOBdata[0],'latitude': MOBdata[1]};
					};
				};
			};
			if(mobPosition){
				mobPosition.longitude = parseFloat(mobPosition.longitude);
				mobPosition.latitude = parseFloat(mobPosition.latitude);
				if(!(isNaN(mobPosition.longitude) || isNaN(mobPosition.latitude))){
					mobMarkerJSON = {
						"type": "FeatureCollection",
						"features": [
							{
								"type": "Feature",
								"geometry": {
									"type": "Point",
									"coordinates": [
										mobPosition.longitude,
										mobPosition.latitude
									]
								},
								"properties": {
									"current": true,
									"mmsi": '',	// пусто - значит, это MOB свой, и кто-нибудь там поправит
									"safety_related_text": ''
								}
							}
						],
						"properties": {
							"timestamp": timestamp
						}
					};
				};
			};
		};
		//console.log('[SignalKMOBtoGeoJSON] mobMarkerJSON:',mobMarkerJSON);
		return mobMarkerJSON;
	}; // end function SignalKMOBtoGeoJSON
	
	function SignalKGeoJSONtoMOB(mobMarkerJSON,status,label='galadrielmap_sk'){
	/* Переделывает Leaflet GeoJSON мультислоя mobMarker в delta формата SignalK для MOB 
	mobMarkerJSON содержит исчерпывающие данные MOB или false
	This function is from the GaladrielMap SignalK edition.
	*/
		//console.log('[SignalKGeoJSONtoMOB] mobMarkerJSON:',mobMarkerJSON);
		let delta = {
			"context": 'vessels.self',
			"updates": [
				{
					"values": [
						{
							"path": "notifications.mob",
							"value": {
								"method": [],
								"state": "normal",
								"message": "",
								"source": typeof instanceSelf !== 'undefined' ? instanceSelf : plugin.id,
								"position": mobMarkerJSON
							}
						}
					],
					"source": {"label": label},
					"timestamp": status ? new Date(mobMarkerJSON.properties.timestamp*1000).toISOString() : new Date().toISOString(),	// Мы завершаем MOB именно сейчас.
				}
			]
		};
		if(status) {
			delta.updates[0].values[0].value.method = ["visual", "sound"];
			delta.updates[0].values[0].value.state = "emergency";
			delta.updates[0].values[0].value.message = "A man overboard!";
		};
		//console.log('[SignalKGeoJSONtoMOB] delta:',delta);
		return delta;
	}; // end function SignalKGeoJSONtoMOB
	

	function updSelf(position){
	/**/
		vehicle.status = app.getSelfPath('navigation.state') ? app.getSelfPath('navigation.state').value : 15;
		vehicle.speed = app.getSelfPath('navigation.speedOverGround') ? app.getSelfPath('navigation.speedOverGround').value : undefined;
		vehicle.lon = position.longitude;
		vehicle.lat = position.latitude;
		vehicle.course = app.getSelfPath('navigation.courseOverGroundTrue') ? app.getSelfPath('navigation.courseOverGroundTrue').value *180/Math.PI : undefined;
		vehicle.heading = app.getSelfPath('navigation.headingTrue') ? Math.round(app.getSelfPath('navigation.headingTrue').value *180/Math.PI) : undefined;
		vehicle.destination = app.getSelfPath('navigation.destination.commonName') ? app.getSelfPath('navigation.destination.commonName').value : undefined;
		vehicle.eta = app.getSelfPath('navigation.destination.eta') ? app.getSelfPath('navigation.destination.eta').value : undefined;			
		//app.debug('navigation.datetime',app.getSelfPath('navigation.datetime'));
		//app.debug('navigation.position',app.getSelfPath('navigation.position'));
		if(app.getSelfPath('navigation.datetime')) vehicle.timestamp = Math.round(Date.parse(app.getSelfPath('navigation.datetime').value)/1000);	// navigation.datetime -- строка iso-8601, переводится в unix timestamp, в секундах
		else if(app.getSelfPath('navigation.position')) vehicle.timestamp = Math.round(Date.parse(app.getSelfPath('navigation.position').timestamp)/1000);	// оно могло быть вызвано по таймауту, и position нет
		else vehicle.timestamp = Math.round(Date.now()/1000);
		
		// Состояние опасности.
		// В SignalK они могут быть одновременно, но в GaladrielMap - просто опасность, с уточнением в тексте.
		// При этом значёк опасности на судне рисуется по тексту.
		// Поэтому здесь запрашивается состояние опасности в порядке моего взгляда на опасность,
		// с тем, чтобы наибольшая опасность была в конце, и отобразился соответствующий значёк.
		let dangers = ['abandon','adrift','sinking','fire','piracy'];
		vehicle.safety_related_text = '';
		for(let danger of dangers){
			const emergency =  app.getSelfPath("notifications."+danger);
			if(!emergency || (emergency.value.state == 'normal')) continue;
			app.debug('[updSelf]',"notifications."+danger,'emergency:',emergency);
			vehicle.status = 14;
			//vehicle.status_text += ' '+emergency.value.message;
			vehicle.safety_related_text = emergency.value.message;
		};
		
		const MOB = app.getSelfPath("notifications.mob");
		//app.debug('[updSelf] MOB:',JSON.stringify(MOB));
		//if(MOB) statusMOB = MOB.value;
		if(MOB) {
			statusMOB = MOB;	// нам нужен timestamp собственно сообщения
		}
		else statusMOB = undefined;
		
		if((vehicle.lon !== undefined) && (vehicle.lat !== undefined)) return true;
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
				// хрен их знает, как правильно. ПО доке - второй вариант, по факту - первый.
				path: 'communication',
				value: {callsignVhf: vessel.callsign}
				//path: 'communication.callsignVhf',
				//value: vessel.callsign
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
				path: 'navigation.state_text',
				value: vessel.status_text
			},
			{
				path: 'navigation.safety_related_text',
				value: vessel.safety_related_text
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
			if(values[i] === undefined) {
				values.splice(i,1);
				i--;
			}
			else if(values[i].value === undefined) {
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
	}; // end function prepareDelta

	


	// Функции сервера
	function netAISserverHelper(req, res){
	/* Содержаетельная часть нашего http сервера: то, что обрабатывает поступивший запрос.
	req - то, что прислали,
	res - то, что отошлём в ответ
	
	netAISserverData - массив с данными netAIS своей группы в формате gpsdPROXY
	*/
		let ret;
		let member = url.parse(req.url,true).query.member; 	// member -- это, собственно, требуемый параметр в запросе
		//app.debug('[netAISserverHelper] member',member);
		let mob = url.parse(req.url,true).query.mob; 	// mob -- параметр в запросе
		//app.debug('[netAISserverHelper] mob',mob);
		try {
			member = JSON.parse(member); 	// member -- это, собственно, требуемый параметр в запросе
			//app.debug('[netAISserverHelper] member',member);
			//mob = JSON.parse(mob);
			//app.debug('[netAISserverHelper] mob',mob);
			//app.debug('netAISserverData',netAISserverData);
			if(member.mmsi && member.lon && member.lat) { 	// прислали достаточно информации
				// запишем присланное в общий файл
				if(!netAISserverData[member.mmsi]) netAISserverData[member.mmsi] = {};
				// Возможно, у нас более полная информация, поэтому цикл
				for(const opt in member){
					netAISserverData[member.mmsi][opt] = member[opt];
				}
				netAISserverData[member.mmsi].netAIS = true;
				//app.debug('options.selfServer.selfMember',options.selfServer.selfMember, app.getSelfPath('navigation.position').value);
				//app.debug('netAISserverData',netAISserverData);
				
				// проверим, что в общем файле протухло
				const now = Math.round(new Date().getTime()/1000); 	// unix timestamp
				//app.debug('now',now,'options.noVehicleTimeout',options.noVehicleTimeout);
				for(const vessel in netAISserverData){
					if((now - netAISserverData[vessel].timestamp) > options.noVehicleTimeout){
						// тут следует сперва удалить этот vessel из SignalK
						// поскольку удалить непонятно как, сделаем координаты и прочее неопределёнными.
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
											value: null	// undefined тут почему-то Illegal value in delta:{"path":"navigation.courseOverGroundTrue"} Потому что undefined нет в json
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
						});
						delete netAISserverData[vessel]; 
					};
				};

				if(mob){
					try {	// В этом кретинском языке ошибка разбора jsom - критическая ошибка, поэтому приходится городить кретинские конструкции.
						mob = JSON.parse(mob);
						netAISserverData[mob.source] = mob;
					}
					catch(error){
					};
				};
				
				// Если я сам - член своей группы - здесь нужен просто запуск клиента к своему серверу.
				// Но было бы странно обращаться к серверу на той же системе через сеть.
				// Поэтому здесь повторяется функциональность клиента, но внутри.
				if(options.selfServer.selfMember) {	
					// передадим всем себя, если указано. Я сам обновляюсь в updSelf.
					if(app.getSelfPath('navigation.position') && updSelf(app.getSelfPath('navigation.position').value)){
						netAISserverData[vehicle.mmsi] = vehicle;
						if(statusMOB) {
							let mobMarkerJSON = SignalKMOBtoGeoJSON(statusMOB.value);	// функция из GaladrielMap SignalK ed.
							//app.debug('[netAISserverHelper] mobMarkerJSON:',JSON.stringify(mobMarkerJSON));
							let status = true;
							if(!mobMarkerJSON || (statusMOB.value.state == 'normal')) status = false;	// режима MOB нет
							mobMarkerJSON = gpsdPROXYGeoJSONtoMOB(mobMarkerJSON,status);
							app.debug('[netAISserverHelper] mobMarkerJSON:',JSON.stringify(mobMarkerJSON));
							netAISserverData[mobMarkerJSON.source] = mobMarkerJSON;
						};
					};
					// Передадим в SignalK всех, из netAISserverData
					inToSignalK(netAISserverData);	// Передаёт пришедние от чужого сервера данные в SignalK 
				};
				//app.debug('netAISserverData',netAISserverData);
				
				ret = netAISserverData;
				res.statusCode = 200;
				// Всё, здесь функция сервера выполнена.
			}
			else {
				ret = {"error": "Spatial info required, sorry."};
				res.statusCode = 400;
			};
		}
		catch (e) { 	// 	облом JSON.parse, включая отсутствие member и прочую фигню
			app.debug(' Server recieve a Bad request ',e);
			ret = {"error": "Bad request: "+e.message};
			res.statusCode = 400;
		};
		//res.setHeader('Content-Type', 'text/plain');
		res.setHeader('Content-Type', 'application/json;charset=utf-8;');
		res.write(JSON.stringify(ret));
		res.end('\n');
	} // end function netAISserver

	
	
	

	// Всякие функции
	function checkTOR(){
	/* Определим наличие tor 
	На самом деле, определям только факт, что указанный порт обслуживается каким-то
	сетевым интерфейсом.
	*/
		try{
			const stdout = execSync(`netstat -an | grep ${options.torPort}`,{encoding: 'utf-8'});	// encoding - это возврат результата в виде текста, а не то, что вы подумали
			//app.debug('[checkTOR] netstat stdout:',stdout);
			return stdout.includes('LISTEN');
		}
		catch (err){
			app.debug('[checkTOR] netstat Error: ',err.toString());
			return null;
		};
	}; // end function checkTOR
	
	function checkYgg(){
	/*/ const stdout = execSync('ip -6 addr | grep -oP "(?<=inet6\s)([a-f0-9:]+)(?=/)"',{encoding: 'utf-8'});
	в этом говёном nodejs не работает, потому что там код возврата - последний адрес.
	А если код не нулевой, то для nodejs это ошибка и всё пропало.
	*/
		let ygg = false;
		const laninterfaces = os.networkInterfaces();
		//app.debug('[checkYgg] ip -6 addr stdout:',laninterfaces);
		br: for(const intName in laninterfaces){	// ищем свой адрес Yggdrasil
			if(intName.substring(0,3)!='tun') continue;	//	интерфейс должен быть туннель
			//app.debug('[checkYgg] laninterfaces[intName]: ',laninterfaces[intName]);
			for(const addr of laninterfaces[intName]){
				if(addr.address.substr(0,1)=='2' || addr.address.substr(0,1)=='3'){	// собственный внешний или внутренней сети адрес Yggdrasil
					ygg = true;
					break br;
				};
			};
		};
		//app.debug('[checkYgg] ygg=',ygg);
		return ygg;
	}; // end function checkYgg()

	
}; // end function plugin.start

plugin.stop = function () {
//
	app.debug('netAIS stopped');
	//app.debug(unsubscribes);
	unsubscribes.forEach(f => f());	// отписаться от всех подписок и всё остальное, что положили в unsubscribes
	unsubscribes = [];
	// Удалим те пароходы, которые получены по netAIS
	const vessels = app.getPath('vessels');
	for( let vessel in vessels){
		//app.debug('[plugin.stop] vessel:',vessel);
		//app.debug('[plugin.stop] vessels[vessel]:',vessels[vessel].communication);
		if(!(vessels[vessel].communication && vessels[vessel].communication.netAIS)) continue;
		//app.debug('[plugin.stop] vessel to remove',vessel);
		/*
		// Это срабатывает без ошибок, но ничего не происходит
		// если указать сперва context: vessels, а потом "path": vessel, то SignalK выдаёт мутную ощибку
		app.handleMessage(plugin.id, {
			"updates": [
				{
					"values": [
						{
							"path": 'vessels.'+vessel,
							"value": {}
						}
					],
					"source": { "label": plugin.id },
					"timestamp": new Date().toISOString(),
				}
			]
		});
		*/
		// Просто сделаем координаты и прочее неопределёнными.
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
							value: null	// undefined тут почему-то Illegal value in delta:{"path":"navigation.courseOverGroundTrue"} Потому что undefined нет в json
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
		});
	}		
	TPVstream = null;
	app.setPluginStatus('Plugin stopped');
};

return plugin;
};
