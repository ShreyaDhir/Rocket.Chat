import { Meteor } from 'meteor/meteor';
import { Match, check } from 'meteor/check';
import { Random } from 'meteor/random';
import _ from 'underscore';

import { Uploads } from '../../../models';
import { Rooms } from '../../../models/server/raw';
import { callbacks } from '../../../callbacks';
import { FileUpload } from '../lib/FileUpload';
import { canAccessRoom } from '../../../authorization/server/functions/canAccessRoom';
import { settings } from '../../../settings/server';

Meteor.methods({
	async sendFileMessage(roomId, store, file, msgData = {}) {
		const user = Meteor.user();
		if (!user) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'sendFileMessage' });
		}

		const room = await Rooms.findOneById(roomId);

		if (user?.type !== 'app' && !canAccessRoom(room, user)) {
			return false;
		}

		check(msgData, {
			avatar: Match.Optional(String),
			emoji: Match.Optional(String),
			alias: Match.Optional(String),
			groupable: Match.Optional(Boolean),
			msg: Match.Optional(String),
			tmid: Match.Optional(String),
		});

		Uploads.updateFileComplete(file._id, user._id, _.omit(file, '_id'));

		const fileUrl = FileUpload.getPath(`${ file._id }/${ encodeURI(file.name) }`);

		const attachment = {
			title: file.name,
			type: 'file',
			description: file.description,
			title_link: fileUrl,
			title_link_download: true,
		};

		let thumbId;

		if (/^image\/.+/.test(file.type)) {
			attachment.image_url = fileUrl;
			attachment.image_type = file.type;
			attachment.image_size = file.size;
			if (file.identify && file.identify.size) {
				attachment.image_dimensions = file.identify.size;
			}

			try {
				attachment.image_preview = await FileUpload.resizeImagePreview(file);

				const thumbBuffer = await FileUpload.createImageThumbnail(file);
				if (thumbBuffer) {
					const thumbnail = FileUpload.uploadImageThumbnail(file, thumbBuffer, roomId, user._id);
					const thumbUrl = FileUpload.getPath(`${ thumbnail._id }/${ encodeURI(file.name) }`);
					attachment.image_url = thumbUrl;
					attachment.image_type = thumbnail.type;
					attachment.image_dimensions = {
						width: settings.get('Message_Attachments_Thumbnails_Width'),
						height: settings.get('Message_Attachments_Thumbnails_Height'),
					};
					thumbId = thumbnail._id;
				}
			} catch (e) {
				delete attachment.image_url;
				delete attachment.image_type;
				delete attachment.image_size;
				delete attachment.image_dimensions;
			}
		} else if (/^audio\/.+/.test(file.type)) {
			attachment.audio_url = fileUrl;
			attachment.audio_type = file.type;
			attachment.audio_size = file.size;
		} else if (/^video\/.+/.test(file.type)) {
			attachment.video_url = fileUrl;
			attachment.video_type = file.type;
			attachment.video_size = file.size;
		}

		let msg = Object.assign({
			_id: Random.id(),
			rid: roomId,
			ts: new Date(),
			msg: '',
			file: {
				_id: file._id,
				thumbId,
				name: file.name,
				type: file.type,
			},
			groupable: false,
			attachments: [attachment],
		}, msgData);

		msg = Meteor.call('sendMessage', msg);

		Meteor.defer(() => callbacks.run('afterFileUpload', { user, room, message: msg }));

		return msg;
	},
});
