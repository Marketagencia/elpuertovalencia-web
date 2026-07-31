FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/redirects.map /etc/nginx/redirects.map
COPY . /usr/share/nginx/html
EXPOSE 80
