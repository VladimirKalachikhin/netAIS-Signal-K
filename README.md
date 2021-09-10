# netAIS Signal K plugin[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## v. 0.0

Exchange AIS-like messages via the Internet to watch position members of your private group. No need for a dedicated server with a real IP address.  
Suitable for fishing, regatta and collective water recreation.  

![scheme](screenshots/art.png)   
Software use [TOR](torproject.org) as a communication environment, so it works smoothly via mobile internet and public wi-fi.

## Features
* Service one private group.
* Membership in any number of groups.

## Technical
Plugin includes a client and a server for one private group. The server must be configured as a TOR hidden service.  
You must get .onion address of this hidden service in any way - by email, SMS or pigeon post, and configure the client with it.  
The client calls to the server with spatial and other info in AIS-like format. Server return info about all of the group members.  

## Demo
Public group for testing:  
**2q6q4phwaduy4mly2mrujxlhpjg7el7z2b4u6s7spghylcd6bv3eqvyd.onion**  This address are default on client configuration interface.  
![private_group_config_screenshot](screenshots/s2.png)   
All active group members are visible on  [GaladrielMap](http://galadrielmap.hs-yachten.at/) [Live demo](http://130.61.159.53/map/).   
![usage_screenshot](screenshots/s1.jpg)   

## Compatibility
Signal K server. 

## Install&configure:
You mast have [TOR service](https://www.torproject.org/docs/tor-manual.html.en) installed.  
Install plugin from Signal K Appstore as **netais**.  
![appstore_screenshot](screenshots/s4.png)   
Restart Signal K,  
Use Server -> Plugin Config menu to configure plugin.   
Press Submit to save changes.

### TOR hidden service
[Configure TOR hidden service](https://www.torproject.org/docs/tor-onion-service.html.en) to serve localhost:3100 (default) addres. Simplest way to it is just adding  
```
HiddenServiceDir /var/lib/tor/hidden_service_netAIS/   
HiddenServicePort 80 localhost:3100  
```
strings to "location-hidden services" section of `/etc/tor/torrc.`
After restart TOR, get address you hidden service by  
```
sudo cat /var/lib/tor/hidden_service_netAIS/hostname  
```
![hidden_server_config_screenshot](screenshots/s3.png)   
It's no need if you want to be a group member only. But working TOR must be have.

## Usage
Any Signal K chartplotters will show netAIS targets in the usual way.

## Support
[Discussions](https://github.com/VladimirKalachikhin/netAIS-Signal-K/discussions/)

You can get support for netAIS software for a beer [via PayPal](https://paypal.me/VladimirKalachikhin) or [YandexMoney](https://yasobe.ru/na/galadrielmap) at [galadrielmap@gmail.com](mailto:galadrielmap@gmail.com)  